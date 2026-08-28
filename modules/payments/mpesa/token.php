<?php

declare(strict_types=1);

require_once dirname(__DIR__, 3) . '/app/helpers/response.php';
require_once dirname(__DIR__, 3) . '/app/helpers/auth.php';
require_once dirname(__DIR__, 3) . '/app/helpers/mpesa.php';

require_role([ROLE_SUPER_ADMIN, ROLE_ADMIN, ROLE_CASHIER]);

try {
    json_response([
        'success' => true,
        'access_token' => mpesa_access_token(),
    ]);
} catch (Throwable $exception) {
    json_response(['success' => false, 'message' => $exception->getMessage()], 500);
}
