<?php

declare(strict_types=1);

require_once dirname(__DIR__, 2) . '/app/helpers/auth.php';
require_role(ROLE_SUPER_ADMIN);

$query = trim((string) ($_GET['q'] ?? ''));
$page = max(1, (int) ($_GET['page'] ?? 1));
$perPage = 10;
$offset = ($page - 1) * $perPage;
$params = [];
$where = '1 = 1';

if ($query !== '') {
    $where .= ' AND (name LIKE ? OR email LIKE ? OR role LIKE ?)';
    $params = ['%' . $query . '%', '%' . $query . '%', '%' . $query . '%'];
}

$stmt = db()->prepare("SELECT COUNT(*) FROM users WHERE {$where}");
$stmt->execute($params);
$total = (int) $stmt->fetchColumn();
$pages = max(1, (int) ceil($total / $perPage));

$stmt = db()->prepare("SELECT id, name, email, role, is_active, last_login_at, created_at FROM users WHERE {$where} ORDER BY name ASC LIMIT {$perPage} OFFSET {$offset}");
$stmt->execute($params);
$users = $stmt->fetchAll();

$edit = null;
if (!empty($_GET['edit'])) {
    $stmt = db()->prepare('SELECT id, name, email, role, is_active FROM users WHERE id = ? LIMIT 1');
    $stmt->execute([(int) $_GET['edit']]);
    $edit = $stmt->fetch() ?: null;
}

require_once dirname(__DIR__, 2) . '/app/components/header.php';
require_once dirname(__DIR__, 2) . '/app/components/topbar.php';
require_once dirname(__DIR__, 2) . '/app/components/sidebar.php';
?>
<main class="module-shell has-sidebar">
    <div class="module-page">
        <?php foreach (consume_flash() as $message): ?>
            <div class="alert alert-<?= htmlspecialchars($message['type'], ENT_QUOTES, 'UTF-8') ?> mb-0"><?= htmlspecialchars($message['message'], ENT_QUOTES, 'UTF-8') ?></div>
        <?php endforeach; ?>

        <section class="module-hero">
            <div>
                <h1>User Management</h1>
                <p>Create users, assign roles, reset passwords, and disable accounts.</p>
            </div>
            <a class="btn btn-primary" href="<?= htmlspecialchars(rtrim(APP_URL, '/'), ENT_QUOTES, 'UTF-8') ?>/modules/users/index.php"><i class="bi bi-person-plus"></i> Add User</a>
        </section>

        <section class="module-grid-2">
            <div class="module-table-wrap">
                <div class="module-panel border-0 border-bottom rounded-0">
                    <h2>System Users</h2>
                    <p>Only Super Admins can manage login accounts.</p>
                    <form class="filter-bar" method="get">
                        <input class="form-control" type="search" name="q" value="<?= htmlspecialchars($query, ENT_QUOTES, 'UTF-8') ?>" placeholder="Search users">
                        <select class="form-select" disabled><option>All Roles</option></select>
                        <button class="btn btn-outline-primary" type="submit">Search</button>
                    </form>
                </div>
                <div class="table-responsive">
                    <table class="table table-hover">
                        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
                        <tbody>
                        <?php foreach ($users as $user): ?>
                            <tr>
                                <td><strong><?= htmlspecialchars($user['name'], ENT_QUOTES, 'UTF-8') ?></strong></td>
                                <td><?= htmlspecialchars($user['email'], ENT_QUOTES, 'UTF-8') ?></td>
                                <td><?= htmlspecialchars(ROLE_LABELS[$user['role']] ?? $user['role'], ENT_QUOTES, 'UTF-8') ?></td>
                                <td><?= (int) $user['is_active'] === 1 ? '<span class="badge-soft success">Active</span>' : '<span class="badge-soft danger">Disabled</span>' ?></td>
                                <td><?= htmlspecialchars((string) ($user['last_login_at'] ?? 'Never'), ENT_QUOTES, 'UTF-8') ?></td>
                                <td><a class="btn btn-sm btn-outline-primary" href="?edit=<?= (int) $user['id'] ?>">Edit</a></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
                <div class="module-panel border-0 border-top rounded-0">
                    <ul class="pagination mb-0">
                        <?php for ($i = 1; $i <= $pages; $i++): ?>
                            <li class="page-item <?= $i === $page ? 'active' : '' ?>"><a class="page-link" href="?q=<?= urlencode($query) ?>&page=<?= $i ?>"><?= $i ?></a></li>
                        <?php endfor; ?>
                    </ul>
                </div>
            </div>

            <aside class="module-panel">
                <h2><?= $edit ? 'Edit User' : 'Create User' ?></h2>
                <p class="mb-3">Use strong passwords and disable accounts instead of deleting audit history.</p>
                <form class="quick-form" method="post" action="<?= htmlspecialchars(rtrim(APP_URL, '/'), ENT_QUOTES, 'UTF-8') ?>/app/actions/user_save.php">
                    <input type="hidden" name="csrf_token" value="<?= htmlspecialchars(csrf_token(), ENT_QUOTES, 'UTF-8') ?>">
                    <input type="hidden" name="id" value="<?= (int) ($edit['id'] ?? 0) ?>">
                    <div><label>Name</label><input class="form-control" name="name" value="<?= htmlspecialchars((string) ($edit['name'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required></div>
                    <div><label>Email</label><input class="form-control" type="email" name="email" value="<?= htmlspecialchars((string) ($edit['email'] ?? ''), ENT_QUOTES, 'UTF-8') ?>" required></div>
                    <div>
                        <label>Role</label>
                        <select class="form-select" name="role" required>
                            <?php foreach (ROLE_LABELS as $value => $label): ?>
                                <option value="<?= htmlspecialchars($value, ENT_QUOTES, 'UTF-8') ?>" <?= ($edit['role'] ?? '') === $value ? 'selected' : '' ?>><?= htmlspecialchars($label, ENT_QUOTES, 'UTF-8') ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <div>
                        <label><?= $edit ? 'New Password' : 'Password' ?></label>
                        <input class="form-control" type="password" name="password" <?= $edit ? '' : 'required' ?> minlength="8">
                    </div>
                    <div>
                        <label>Status</label>
                        <select class="form-select" name="is_active">
                            <option value="1" <?= (int) ($edit['is_active'] ?? 1) === 1 ? 'selected' : '' ?>>Active</option>
                            <option value="0" <?= (int) ($edit['is_active'] ?? 1) === 0 ? 'selected' : '' ?>>Disabled</option>
                        </select>
                    </div>
                    <button class="btn btn-primary" type="submit"><i class="bi bi-save"></i> Save User</button>
                </form>
            </aside>
        </section>
    </div>
</main>
<?php require_once dirname(__DIR__, 2) . '/app/components/footer.php'; ?>
