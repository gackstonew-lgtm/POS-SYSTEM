<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/app/helpers/auth.php';
require_once dirname(__DIR__, 2) . '/app/helpers/mpesa.php';
require_role([ROLE_SUPER_ADMIN, ROLE_ADMIN]);

$pdo = db();
$from = $_GET['from'] ?? date('Y-m-01');
$to = $_GET['to'] ?? date('Y-m-d');
$cashierId = (int) ($_GET['cashier_id'] ?? 0);
$phone = trim((string) ($_GET['phone'] ?? ''));

$cashiers = $pdo->query("SELECT id, name FROM users WHERE role IN ('cashier','admin','super_admin') ORDER BY name ASC")->fetchAll();

$salesWhere = 'DATE(s.created_at) BETWEEN ? AND ?';
$salesParams = [$from, $to];
if ($cashierId > 0) {
    $salesWhere .= ' AND s.cashier_id = ?';
    $salesParams[] = $cashierId;
}

$stmt = $pdo->prepare("SELECT COALESCE(SUM(s.total),0) total, COUNT(*) count FROM sales s WHERE {$salesWhere}");
$stmt->execute($salesParams);
$sales = $stmt->fetch();

$stmt = $pdo->prepare('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE deleted_at IS NULL AND expense_date BETWEEN ? AND ?');
$stmt->execute([$from, $to]);
$expenseTotal = (float) $stmt->fetchColumn();

$stmt = $pdo->prepare("SELECT p.name, SUM(si.quantity) qty, SUM(si.line_total) total FROM sale_items si JOIN products p ON p.id = si.product_id JOIN sales s ON s.id = si.sale_id WHERE {$salesWhere} GROUP BY p.id, p.name ORDER BY qty DESC LIMIT 10");
$stmt->execute($salesParams);
$topProducts = $stmt->fetchAll();

$mpesaSetupError = null;
$mpesaSummary = ['total' => 0, 'count' => 0];
$todayMpesa = 0.0;
$monthlyMpesa = 0.0;
$pendingMpesa = 0;
$failedMpesa = 0;
$mpesaTransactions = [];

try {
    mpesa_assert_schema();

    $mpesaWhere = 'DATE(mt.created_at) BETWEEN ? AND ?';
    $mpesaParams = [$from, $to];
    if ($cashierId > 0) {
        $mpesaWhere .= ' AND s.cashier_id = ?';
        $mpesaParams[] = $cashierId;
    }
    if ($phone !== '') {
        $mpesaWhere .= ' AND mt.phone_number LIKE ?';
        $mpesaParams[] = '%' . preg_replace('/\D+/', '', $phone) . '%';
    }

    $stmt = $pdo->prepare("SELECT COALESCE(SUM(CASE WHEN mt.status = 'success' THEN mt.amount ELSE 0 END),0) total, COUNT(*) count FROM mpesa_transactions mt LEFT JOIN sales s ON s.id = mt.sale_id WHERE {$mpesaWhere}");
    $stmt->execute($mpesaParams);
    $mpesaSummary = $stmt->fetch();

    $todayMpesa = (float) $pdo->query("SELECT COALESCE(SUM(amount),0) FROM mpesa_transactions WHERE status = 'success' AND DATE(created_at) = CURDATE()")->fetchColumn();
    $monthlyMpesa = (float) $pdo->query("SELECT COALESCE(SUM(amount),0) FROM mpesa_transactions WHERE status = 'success' AND YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())")->fetchColumn();
    $pendingMpesa = (int) $pdo->query("SELECT COUNT(*) FROM mpesa_transactions WHERE status = 'pending'")->fetchColumn();
    $failedMpesa = (int) $pdo->query("SELECT COUNT(*) FROM mpesa_transactions WHERE status IN ('failed','cancelled','timeout')")->fetchColumn();

    $stmt = $pdo->prepare(
        "SELECT mt.*, s.reference, u.name AS cashier_name
         FROM mpesa_transactions mt
         LEFT JOIN sales s ON s.id = mt.sale_id
         LEFT JOIN users u ON u.id = s.cashier_id
         WHERE {$mpesaWhere}
         ORDER BY mt.created_at DESC
         LIMIT 100"
    );
    $stmt->execute($mpesaParams);
    $mpesaTransactions = $stmt->fetchAll();
} catch (Throwable $exception) {
    $mpesaSetupError = $exception->getMessage();
}

require_once dirname(__DIR__, 2) . '/app/components/header.php';
require_once dirname(__DIR__, 2) . '/app/components/topbar.php';
require_once dirname(__DIR__, 2) . '/app/components/sidebar.php';
?>
<main class="module-shell has-sidebar">
    <div class="module-page">
        <section class="module-hero">
            <div>
                <h1>Reports & Analytics</h1>
                <p>Review sales, expenses, profit, and product performance.</p>
            </div>
            <form class="module-actions" method="get">
                <input class="form-control" type="date" name="from" value="<?= htmlspecialchars((string) $from, ENT_QUOTES, 'UTF-8') ?>">
                <input class="form-control" type="date" name="to" value="<?= htmlspecialchars((string) $to, ENT_QUOTES, 'UTF-8') ?>">
                <select class="form-select" name="cashier_id">
                    <option value="0">All Cashiers</option>
                    <?php foreach ($cashiers as $cashier): ?>
                        <option value="<?= (int) $cashier['id'] ?>" <?= $cashierId === (int) $cashier['id'] ? 'selected' : '' ?>><?= htmlspecialchars($cashier['name'], ENT_QUOTES, 'UTF-8') ?></option>
                    <?php endforeach; ?>
                </select>
                <input class="form-control" type="search" name="phone" value="<?= htmlspecialchars($phone, ENT_QUOTES, 'UTF-8') ?>" placeholder="M-PESA phone">
                <button class="btn btn-primary" type="submit">Run Report</button>
            </form>
        </section>

        <section class="summary-strip">
            <article class="summary-tile"><i class="bi bi-cash-stack"></i><div><small>Sales</small><strong>KES <?= number_format((float) $sales['total'], 2) ?></strong></div></article>
            <article class="summary-tile"><i class="bi bi-receipt"></i><div><small>Expenses</small><strong>KES <?= number_format($expenseTotal, 2) ?></strong></div></article>
            <article class="summary-tile"><i class="bi bi-graph-up"></i><div><small>Net</small><strong>KES <?= number_format(((float) $sales['total']) - $expenseTotal, 2) ?></strong></div></article>
            <article class="summary-tile"><i class="bi bi-cart-check"></i><div><small>Transactions</small><strong><?= (int) $sales['count'] ?></strong></div></article>
        </section>

        <section class="summary-strip">
            <article class="summary-tile"><i class="bi bi-phone"></i><div><small>Today's M-PESA</small><strong>KES <?= number_format($todayMpesa, 2) ?></strong></div></article>
            <article class="summary-tile"><i class="bi bi-calendar-month"></i><div><small>Monthly M-PESA</small><strong>KES <?= number_format($monthlyMpesa, 2) ?></strong></div></article>
            <article class="summary-tile"><i class="bi bi-hourglass-split"></i><div><small>Pending Payments</small><strong><?= $pendingMpesa ?></strong></div></article>
            <article class="summary-tile"><i class="bi bi-x-circle"></i><div><small>Failed Payments</small><strong><?= $failedMpesa ?></strong></div></article>
        </section>

        <?php if ($mpesaSetupError): ?>
            <div class="alert alert-warning mb-0"><?= htmlspecialchars($mpesaSetupError, ENT_QUOTES, 'UTF-8') ?></div>
        <?php endif; ?>

        <section class="module-table-wrap">
            <div class="module-panel border-0 border-bottom rounded-0">
                <h2>M-PESA Transaction History</h2>
                <p>Total in filter: KES <?= number_format((float) $mpesaSummary['total'], 2) ?> across <?= (int) $mpesaSummary['count'] ?> transaction(s).</p>
            </div>
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead><tr><th>Sale</th><th>Receipt</th><th>Phone</th><th>Amount</th><th>Status</th><th>Cashier</th><th>Result</th><th>Date</th></tr></thead>
                    <tbody>
                    <?php if (!$mpesaTransactions): ?>
                        <tr><td colspan="8" class="text-center text-muted py-4">No M-PESA transactions found.</td></tr>
                    <?php endif; ?>
                    <?php foreach ($mpesaTransactions as $transaction): ?>
                        <tr>
                            <td><?= htmlspecialchars((string) ($transaction['reference'] ?? 'Pending sale'), ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= htmlspecialchars((string) ($transaction['receipt_number'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= htmlspecialchars((string) ($transaction['phone_number'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>
                            <td>KES <?= number_format((float) $transaction['amount'], 2) ?></td>
                            <td><span class="badge-soft <?= $transaction['status'] === 'success' ? 'success' : ($transaction['status'] === 'pending' ? 'warning' : 'danger') ?>"><?= htmlspecialchars((string) $transaction['status'], ENT_QUOTES, 'UTF-8') ?></span></td>
                            <td><?= htmlspecialchars((string) ($transaction['cashier_name'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= htmlspecialchars((string) ($transaction['result_description'] ?? ''), ENT_QUOTES, 'UTF-8') ?></td>
                            <td><?= htmlspecialchars((string) ($transaction['transaction_date'] ?? $transaction['created_at']), ENT_QUOTES, 'UTF-8') ?></td>
                        </tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>

        <section class="module-table-wrap">
            <div class="module-panel border-0 border-bottom rounded-0">
                <h2>Top Products</h2>
                <p>Best selling items for the selected period.</p>
            </div>
            <div class="table-responsive">
                <table class="table table-hover">
                    <thead><tr><th>Product</th><th>Quantity</th><th>Total</th></tr></thead>
                    <tbody>
                    <?php if (!$topProducts): ?>
                        <tr><td colspan="3" class="text-center text-muted py-4">No sales found for this period.</td></tr>
                    <?php endif; ?>
                    <?php foreach ($topProducts as $product): ?>
                        <tr><td><strong><?= htmlspecialchars($product['name'], ENT_QUOTES, 'UTF-8') ?></strong></td><td><?= (int) $product['qty'] ?></td><td>KES <?= number_format((float) $product['total'], 2) ?></td></tr>
                    <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </section>
    </div>
</main>
<?php require_once dirname(__DIR__, 2) . '/app/components/footer.php'; ?>
