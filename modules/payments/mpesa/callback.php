<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/app/helpers/mpesa.php';

$rawPayload = file_get_contents('php://input') ?: '';
$payload = json_decode($rawPayload, true);

http_response_code(200);
header('Content-Type: application/json; charset=utf-8');

if (!is_array($payload)) {
    echo json_encode(['ResultCode' => 1, 'ResultDesc' => 'Invalid callback payload']);
    exit;
}

$callback = $payload['Body']['stkCallback'] ?? null;
if (!is_array($callback)) {
    echo json_encode(['ResultCode' => 1, 'ResultDesc' => 'Missing stkCallback']);
    exit;
}

$merchantRequestId = (string) ($callback['MerchantRequestID'] ?? '');
$checkoutRequestId = (string) ($callback['CheckoutRequestID'] ?? '');
$resultCode = (int) ($callback['ResultCode'] ?? -1);
$resultDescription = (string) ($callback['ResultDesc'] ?? 'No result description');
$metadataItems = $callback['CallbackMetadata']['Item'] ?? [];
$metadata = [];

if (is_array($metadataItems)) {
    foreach ($metadataItems as $item) {
        if (isset($item['Name'])) {
            $metadata[(string) $item['Name']] = $item['Value'] ?? null;
        }
    }
}

$receipt = isset($metadata['MpesaReceiptNumber']) ? (string) $metadata['MpesaReceiptNumber'] : null;
$phone = isset($metadata['PhoneNumber']) ? (string) $metadata['PhoneNumber'] : null;
$amount = isset($metadata['Amount']) ? (float) $metadata['Amount'] : null;
$transactionDate = isset($metadata['TransactionDate']) ? (string) $metadata['TransactionDate'] : null;
if ($transactionDate !== null && preg_match('/^\d{14}$/', $transactionDate)) {
    $transactionDate = substr($transactionDate, 0, 4) . '-' . substr($transactionDate, 4, 2) . '-' . substr($transactionDate, 6, 2)
        . ' ' . substr($transactionDate, 8, 2) . ':' . substr($transactionDate, 10, 2) . ':' . substr($transactionDate, 12, 2);
}

$status = match ($resultCode) {
    0 => 'success',
    1032 => 'cancelled',
    1037, 1025 => 'timeout',
    default => 'failed',
};

$pdo = db();

try {
    mpesa_assert_schema();
    $pdo->beginTransaction();

    $stmt = $pdo->prepare('SELECT * FROM mpesa_transactions WHERE checkout_request_id = ? FOR UPDATE');
    $stmt->execute([$checkoutRequestId]);
    $transaction = $stmt->fetch();

    if (!$transaction) {
        $pdo->prepare(
            "INSERT INTO mpesa_transactions
            (merchant_request_id, checkout_request_id, receipt_number, phone_number, amount, status, result_code, result_description, transaction_date, raw_callback)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )->execute([
            $merchantRequestId,
            $checkoutRequestId,
            $receipt,
            $phone,
            $amount ?? 0,
            $status,
            $resultCode,
            $resultDescription,
            $transactionDate,
            $rawPayload,
        ]);
        $pdo->commit();
        echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Callback stored without matching sale']);
        exit;
    }

    $alreadySuccessful = $transaction['status'] === 'success';

    $pdo->prepare(
        "UPDATE mpesa_transactions
        SET merchant_request_id = ?, receipt_number = COALESCE(?, receipt_number), phone_number = COALESCE(?, phone_number),
            amount = COALESCE(?, amount), status = ?, result_code = ?, result_description = ?,
            transaction_date = COALESCE(?, transaction_date), raw_callback = ?
        WHERE id = ?"
    )->execute([
        $merchantRequestId,
        $receipt,
        $phone,
        $amount,
        $status,
        $resultCode,
        $resultDescription,
        $transactionDate,
        $rawPayload,
        (int) $transaction['id'],
    ]);

    if ($status === 'success' && !$alreadySuccessful) {
        mpesa_complete_paid_sale($pdo, (int) $transaction['sale_id']);
    } elseif ($status !== 'success' && !empty($transaction['sale_id'])) {
        $pdo->prepare('UPDATE sales SET payment_status = ? WHERE id = ? AND payment_status <> ?')
            ->execute(['failed', (int) $transaction['sale_id'], 'paid']);
    }

    $pdo->commit();
    echo json_encode(['ResultCode' => 0, 'ResultDesc' => 'Callback processed successfully']);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    echo json_encode(['ResultCode' => 1, 'ResultDesc' => $exception->getMessage()]);
}
