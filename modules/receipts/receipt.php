<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/app/helpers/auth.php';
require_role([ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_CASHIER]);

$saleId = (int) ($_GET['sale_id'] ?? 0);
if ($saleId <= 0) {
    http_response_code(404);
    exit('Receipt not found.');
}

$stmt = db()->prepare(
    'SELECT s.*, u.name AS cashier_name, mt.receipt_number, mt.phone_number, mt.transaction_date
     FROM sales s
     LEFT JOIN users u ON u.id = s.cashier_id
     LEFT JOIN mpesa_transactions mt ON mt.sale_id = s.id AND mt.status = "success"
     WHERE s.id = ?
     LIMIT 1'
);
$stmt->execute([$saleId]);
$sale = $stmt->fetch();

if (!$sale) {
    http_response_code(404);
    exit('Receipt not found.');
}

$items = db()->prepare(
    'SELECT si.*, p.name
     FROM sale_items si
     JOIN products p ON p.id = si.product_id
     WHERE si.sale_id = ?
     ORDER BY si.id ASC'
);
$items->execute([$saleId]);
$lines = $items->fetchAll();

require_once dirname(__DIR__, 2) . '/app/components/header.php';
?>
<main class="module-shell">
    <section class="module-panel mx-auto" style="max-width: 520px;">
        <div class="text-center mb-3">
            <h1 class="h4 mb-1"><?= htmlspecialchars(APP_NAME, ENT_QUOTES, 'UTF-8') ?></h1>
            <p class="text-muted mb-0">Sales Receipt</p>
        </div>

        <div class="d-flex justify-content-between border-top border-bottom py-2 mb-3">
            <span>Receipt</span>
            <strong><?= htmlspecialchars($sale['reference'], ENT_QUOTES, 'UTF-8') ?></strong>
        </div>

        <div class="small mb-3">
            <div><strong>Date:</strong> <?= htmlspecialchars((string) $sale['created_at'], ENT_QUOTES, 'UTF-8') ?></div>
            <div><strong>Cashier:</strong> <?= htmlspecialchars((string) ($sale['cashier_name'] ?? 'Cashier'), ENT_QUOTES, 'UTF-8') ?></div>
            <div><strong>Customer:</strong> <?= htmlspecialchars((string) ($sale['customer_name'] ?? 'Walk-in customer'), ENT_QUOTES, 'UTF-8') ?></div>
            <div><strong>Payment Method:</strong> <?= strtoupper(htmlspecialchars((string) $sale['payment_method'], ENT_QUOTES, 'UTF-8')) ?></div>
            <?php if ($sale['payment_method'] === 'mpesa'): ?>
                <div><strong>M-PESA Receipt:</strong> <?= htmlspecialchars((string) ($sale['receipt_number'] ?? 'Pending'), ENT_QUOTES, 'UTF-8') ?></div>
                <div><strong>M-PESA Phone:</strong> <?= htmlspecialchars((string) ($sale['phone_number'] ?? ''), ENT_QUOTES, 'UTF-8') ?></div>
                <div><strong>Transaction Date:</strong> <?= htmlspecialchars((string) ($sale['transaction_date'] ?? ''), ENT_QUOTES, 'UTF-8') ?></div>
            <?php endif; ?>
        </div>

        <table class="table table-sm">
            <thead><tr><th>Item</th><th class="text-end">Qty</th><th class="text-end">Total</th></tr></thead>
            <tbody>
            <?php foreach ($lines as $line): ?>
                <tr>
                    <td><?= htmlspecialchars($line['name'], ENT_QUOTES, 'UTF-8') ?><br><span class="text-muted">KES <?= number_format((float) $line['unit_price'], 2) ?></span></td>
                    <td class="text-end"><?= (int) $line['quantity'] ?></td>
                    <td class="text-end">KES <?= number_format((float) $line['line_total'], 2) ?></td>
                </tr>
            <?php endforeach; ?>
            </tbody>
        </table>

        <div class="border-top pt-3">
            <div class="summary-row"><span>Subtotal</span><strong>KES <?= number_format((float) $sale['subtotal'], 2) ?></strong></div>
            <div class="summary-row"><span>Discount</span><strong>KES <?= number_format((float) $sale['discount'], 2) ?></strong></div>
            <div class="summary-row"><span>Tax</span><strong>KES <?= number_format((float) $sale['tax'], 2) ?></strong></div>
            <div class="summary-row"><span class="summary-total">Total</span><strong class="summary-total">KES <?= number_format((float) $sale['total'], 2) ?></strong></div>
        </div>

        <div class="d-print-none mt-3 d-flex gap-2">
            <button class="btn btn-primary" onclick="window.print()">Print Receipt</button>
            <a class="btn btn-outline-primary" href="<?= htmlspecialchars(rtrim(APP_URL, '/'), ENT_QUOTES, 'UTF-8') ?>/modules/pos/pos_checkout.php">Back to POS</a>
        </div>
    </section>
</main>
<script>
    window.addEventListener('load', () => setTimeout(() => window.print(), 500));
</script>
<?php require_once dirname(__DIR__, 2) . '/app/components/footer.php'; ?>
