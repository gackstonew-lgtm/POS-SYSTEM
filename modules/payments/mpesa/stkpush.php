<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/app/helpers/response.php';
require_once dirname(__DIR__, 3) . '/app/helpers/auth.php';
require_once dirname(__DIR__, 3) . '/app/helpers/mpesa.php';

require_role([ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_CASHIER]);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    json_response(['success' => false, 'message' => 'Invalid request method.'], 405);
}

verify_csrf();

$payload = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($payload)) {
    json_response(['success' => false, 'message' => 'Invalid STK request.'], 422);
}

$saleId = (int) ($payload['sale_id'] ?? 0);
$phone = (string) ($payload['phone_number'] ?? '');

if ($saleId <= 0) {
    json_response(['success' => false, 'message' => 'Missing sale reference.'], 422);
}

$normalizedPhone = mpesa_normalize_phone($phone);
if ($normalizedPhone === null) {
    json_response(['success' => false, 'message' => 'Enter a valid Kenyan phone number, for example 254712345678.'], 422);
}

$pdo = db();

try {
    mpesa_assert_schema();
    $pdo->beginTransaction();

    $stmt = $pdo->prepare('SELECT id, total, payment_method, payment_status FROM sales WHERE id = ? FOR UPDATE');
    $stmt->execute([$saleId]);
    $sale = $stmt->fetch();

    if (!$sale) {
        throw new RuntimeException('Sale not found.');
    }
    if ($sale['payment_method'] !== 'mpesa') {
        throw new RuntimeException('This sale is not marked as M-PESA.');
    }
    if ($sale['payment_status'] === 'paid') {
        throw new RuntimeException('This sale is already paid.');
    }

    $existing = $pdo->prepare("SELECT * FROM mpesa_transactions WHERE sale_id = ? AND status IN ('pending', 'success') ORDER BY id DESC LIMIT 1");
    $existing->execute([$saleId]);
    $transaction = $existing->fetch();

    if ($transaction && $transaction['status'] === 'success') {
        throw new RuntimeException('This M-PESA payment is already completed.');
    }
    if ($transaction && $transaction['status'] === 'pending') {
        $pdo->commit();
        json_response([
            'success' => true,
            'message' => 'STK Push already sent. Waiting for customer confirmation.',
            'sale_id' => $saleId,
            'checkout_request_id' => $transaction['checkout_request_id'],
            'status' => 'pending',
        ]);
    }

    $pdo->commit();

    $response = mpesa_send_stk_push($saleId, $normalizedPhone, (float) $sale['total']);

    $pdo->beginTransaction();
    $stmt = $pdo->prepare(
        "INSERT INTO mpesa_transactions
        (sale_id, merchant_request_id, checkout_request_id, phone_number, amount, status, result_description)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)"
    );
    $stmt->execute([
        $saleId,
        $response['MerchantRequestID'] ?? null,
        $response['CheckoutRequestID'] ?? null,
        $normalizedPhone,
        (float) $sale['total'],
        $response['CustomerMessage'] ?? $response['ResponseDescription'] ?? 'STK Push sent.',
    ]);
    $pdo->commit();

    json_response([
        'success' => true,
        'message' => 'STK Push sent. Waiting for customer...',
        'sale_id' => $saleId,
        'merchant_request_id' => $response['MerchantRequestID'] ?? null,
        'checkout_request_id' => $response['CheckoutRequestID'] ?? null,
        'status' => 'pending',
    ]);
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }

    $message = str_contains($exception->getMessage(), 'Base table or view not found')
        ? 'M-PESA setup is incomplete. Import database/migration_2026_07_11_mpesa_daraja.sql, then try again.'
        : $exception->getMessage();

    json_response(['success' => false, 'message' => $message], 422);
}
