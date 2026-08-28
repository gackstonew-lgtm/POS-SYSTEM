<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/app/helpers/response.php';
require_once dirname(__DIR__, 3) . '/app/helpers/auth.php';
require_once dirname(__DIR__, 3) . '/app/helpers/mpesa.php';

require_role([ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_CASHIER]);

$saleId = (int) ($_GET['sale_id'] ?? 0);
$checkoutRequestId = trim((string) ($_GET['checkout_request_id'] ?? ''));

if ($saleId <= 0 && $checkoutRequestId === '') {
    json_response(['success' => false, 'message' => 'Missing payment reference.'], 422);
}

try {
    mpesa_assert_schema();
} catch (Throwable $exception) {
    json_response(['success' => false, 'message' => $exception->getMessage()], 500);
}

$where = $saleId > 0 ? 'sale_id = ?' : 'checkout_request_id = ?';
$params = [$saleId > 0 ? $saleId : $checkoutRequestId];

$stmt = db()->prepare("SELECT mt.*, s.payment_status, s.reference FROM mpesa_transactions mt LEFT JOIN sales s ON s.id = mt.sale_id WHERE {$where} ORDER BY mt.id DESC LIMIT 1");
$stmt->execute($params);
$transaction = $stmt->fetch();

if (!$transaction) {
    json_response(['success' => true, 'status' => 'not_found', 'message' => 'Waiting for STK Push to be sent.']);
}

json_response([
    'success' => true,
    'status' => $transaction['status'],
    'sale_id' => (int) $transaction['sale_id'],
    'sale_reference' => $transaction['reference'],
    'payment_status' => $transaction['payment_status'],
    'receipt_number' => $transaction['receipt_number'],
    'phone_number' => $transaction['phone_number'],
    'transaction_date' => $transaction['transaction_date'],
    'result_code' => $transaction['result_code'],
    'result_description' => $transaction['result_description'],
]);
