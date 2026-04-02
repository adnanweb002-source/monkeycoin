// Declarative endpoint catalog.
//
// NOTE: This list is intentionally broad; some endpoints are destructive or require
// pre-existing DB state. The scenario runner will order calls and can skip
// certain endpoints depending on env flags.

export const AuthMode = {
  PUBLIC: 'public',
  USER: 'user',
  ADMIN: 'admin',
};

export const excludedTOTPEndpoints = [
  { method: 'POST', path: '/auth/change-password' },
  { method: 'POST', path: '/auth/change-email' },
  { method: 'POST', path: '/auth/2fa/verify' },
  { method: 'POST', path: '/auth/2fa/change/initiate' },
  { method: 'POST', path: '/auth/2fa/change/confirm' },
];

// For each endpoint, `build(ctx, endpoint)` should return { payload, query, params }.
// Where a payload is not applicable, it may return `null`.
export const endpointCatalog = [
  // Infrastructure / health
  { key: 'root', method: 'GET', path: '/', auth: AuthMode.PUBLIC },
  { key: 'health', method: 'GET', path: '/health', auth: AuthMode.PUBLIC },
  { key: 'metrics', method: 'GET', path: '/metrics', auth: AuthMode.PUBLIC },
  { key: 'swaggerUI', method: 'GET', path: '/api/docs', auth: AuthMode.PUBLIC },
  { key: 'swaggerJSON', method: 'GET', path: '/api/docs-json', auth: AuthMode.PUBLIC },

  // Auth
  { key: 'authRegister', method: 'POST', path: '/auth/register', auth: AuthMode.PUBLIC },
  { key: 'authLogin', method: 'POST', path: '/auth/login', auth: AuthMode.PUBLIC },
  { key: 'authRefresh', method: 'POST', path: '/auth/refresh', auth: AuthMode.USER },
  { key: 'authLogout', method: 'POST', path: '/auth/logout', auth: AuthMode.USER },
  { key: 'authChangeAvatar', method: 'POST', path: '/auth/change-avatar', auth: AuthMode.USER },
  { key: 'authUpdateProfile', method: 'POST', path: '/auth/update-user-profile', auth: AuthMode.USER },
  { key: 'auth2faSetup', method: 'POST', path: '/auth/2fa/setup', auth: AuthMode.USER },
  { key: 'authGetProfile', method: 'GET', path: '/auth/get-profile', auth: AuthMode.USER },
  { key: 'authForgotPassword', method: 'POST', path: '/auth/forgot-password', auth: AuthMode.PUBLIC },
  { key: 'authResetPassword', method: 'POST', path: '/auth/reset-password', auth: AuthMode.PUBLIC },
  { key: 'authRequest2faReset', method: 'POST', path: '/auth/request-2fa-reset', auth: AuthMode.PUBLIC },
  { key: 'authRequest2faResetByAdmin', method: 'POST', path: '/auth/request-2fa-reset-by-admin', auth: AuthMode.PUBLIC },
  { key: 'authReset2fa', method: 'POST', path: '/auth/reset-2fa', auth: AuthMode.PUBLIC },
  { key: 'authAdminUsers2faReset', method: 'POST', path: '/auth/admin/users/:id/2fa-reset', auth: AuthMode.ADMIN },
  { key: 'authAdminLoginForUser', method: 'POST', path: '/auth/admin-login-for-user', auth: AuthMode.ADMIN },
  { key: 'authAdmin2faResetRequestsList', method: 'GET', path: '/auth/admin/2fa-reset-requests', auth: AuthMode.ADMIN },
  { key: 'authAdmin2faResetRequestsStatus', method: 'POST', path: '/auth/admin/2fa-reset-requests/:id/status', auth: AuthMode.ADMIN },

  // Admin Users
  { key: 'adminUsersList', method: 'GET', path: '/admin/users/list', auth: AuthMode.ADMIN },
  { key: 'adminUsersSuspend', method: 'PATCH', path: '/admin/users/:userId/suspend', auth: AuthMode.ADMIN },
  { key: 'adminUsersActivate', method: 'PATCH', path: '/admin/users/:userId/activate', auth: AuthMode.ADMIN },
  { key: 'adminUsersDisable2fa', method: 'PATCH', path: '/admin/users/:userId/disable-2fa', auth: AuthMode.ADMIN },
  { key: 'adminUsersRestrictWithdrawal', method: 'PATCH', path: '/admin/users/:userId/restrict-withdrawal', auth: AuthMode.ADMIN },
  { key: 'adminUsersRestrictCrossLine', method: 'PATCH', path: '/admin/users/:userId/restrict-cross-line-transfer', auth: AuthMode.ADMIN },
  { key: 'adminUsersSetPassword', method: 'PATCH', path: '/admin/users/:userId/set-password', auth: AuthMode.ADMIN },
  { key: 'adminUsersProfile', method: 'PATCH', path: '/admin/users/:userId/profile', auth: AuthMode.ADMIN },

  // Admin controller
  { key: 'adminBootstrapCompany', method: 'POST', path: '/admin/bootstrap/company', auth: AuthMode.ADMIN },
  { key: 'adminWalletLimitsGet', method: 'GET', path: '/admin/get-wallet-limits', auth: AuthMode.ADMIN },
  { key: 'adminWalletLimitsUpsert', method: 'POST', path: '/admin/wallet-limits/upsert', auth: AuthMode.ADMIN },
  { key: 'adminRunDailyReturns', method: 'POST', path: '/admin/run-daily-returns', auth: AuthMode.ADMIN },
  { key: 'adminPruneSystem', method: 'POST', path: '/admin/prune-system', auth: AuthMode.ADMIN, destructive: true },
  { key: 'adminSettingsUpsert', method: 'POST', path: '/admin/settings/upsert', auth: AuthMode.ADMIN },
  { key: 'adminSettingsGet', method: 'GET', path: '/admin/settings/get', auth: AuthMode.ADMIN },
  { key: 'adminExportUserData', method: 'GET', path: '/admin/export-user-data', auth: AuthMode.ADMIN },
  { key: 'adminCreateRank', method: 'POST', path: '/admin/create-rank', auth: AuthMode.ADMIN },
  { key: 'adminUpdateRank', method: 'PATCH', path: '/admin/ranks/:id', auth: AuthMode.ADMIN },
  { key: 'adminDeleteRank', method: 'DELETE', path: '/admin/ranks/:id', auth: AuthMode.ADMIN, destructive: true },
  { key: 'adminStats', method: 'GET', path: '/admin/stats', auth: AuthMode.ADMIN },
  { key: 'adminDepositBonusCreate', method: 'POST', path: '/admin/deposit-bonus', auth: AuthMode.ADMIN },
  { key: 'adminDepositBonusList', method: 'GET', path: '/admin/deposit-bonus', auth: AuthMode.ADMIN },
  { key: 'adminDepositBonusUpdate', method: 'PATCH', path: '/admin/deposit-bonus/:id', auth: AuthMode.ADMIN },
  { key: 'adminDepositBonusDelete', method: 'DELETE', path: '/admin/deposit-bonus/:id', auth: AuthMode.ADMIN, destructive: true },

  // Wallet (user)
  { key: 'walletUserWallets', method: 'GET', path: '/wallet/user-wallets', auth: AuthMode.USER },
  { key: 'walletTransfer', method: 'POST', path: '/wallet/transfer', auth: AuthMode.USER, financial: true },
  { key: 'walletInternalTransfer', method: 'POST', path: '/wallet/internal-transfer', auth: AuthMode.USER, financial: true },
  { key: 'walletWithdraw', method: 'POST', path: '/wallet/withdraw', auth: AuthMode.USER, financial: true },
  { key: 'walletWebhookDeposit', method: 'POST', path: '/wallet/webhook/deposit', auth: AuthMode.PUBLIC, financial: true, webhook: true },
  { key: 'walletDepositRequest', method: 'POST', path: '/wallet/deposit-request', auth: AuthMode.USER, financial: true },
  { key: 'walletCryptoDeposit', method: 'POST', path: '/wallet/deposit/crypto', auth: AuthMode.USER, financial: true },
  { key: 'walletDepositStatus', method: 'GET', path: '/wallet/deposit-status/:id', auth: AuthMode.USER },
  { key: 'walletDepositHistory', method: 'GET', path: '/wallet/deposit/history', auth: AuthMode.USER },
  { key: 'walletDepositRequestsList', method: 'POST', path: '/wallet/deposit-requests', auth: AuthMode.USER },
  { key: 'walletWithdrawalRequestsList', method: 'GET', path: '/wallet/withdraw-requests', auth: AuthMode.USER },
  { key: 'walletWithdrawalCancel', method: 'POST', path: '/wallet/withdrawal/:id/cancel', auth: AuthMode.USER, financial: false },
  { key: 'walletTransactions', method: 'POST', path: '/wallet/transactions', auth: AuthMode.USER, financial: false },
  { key: 'walletIncomeBinary', method: 'GET', path: '/wallet/income/binary', auth: AuthMode.USER },
  { key: 'walletIncomeDirect', method: 'GET', path: '/wallet/income/direct', auth: AuthMode.USER },
  { key: 'walletIncomeReferral', method: 'GET', path: '/wallet/income/referral', auth: AuthMode.USER },
  { key: 'walletIncomeGainReport', method: 'GET', path: '/wallet/income/gain-report', auth: AuthMode.USER },

  // External wallet management
  { key: 'walletCreateExternalWallet', method: 'POST', path: '/wallet/create-external-wallet', auth: AuthMode.USER },
  { key: 'walletUpdateExternalWallet', method: 'PUT', path: '/wallet/:walletId/update-external-wallet', auth: AuthMode.USER },
  { key: 'walletDeleteExternalWallet', method: 'DELETE', path: '/wallet/:walletId/delete-external-wallet', auth: AuthMode.USER },
  { key: 'walletListMyExternalWallets', method: 'GET', path: '/wallet/my-external-wallets', auth: AuthMode.USER },

  // Wallet (admin)
  { key: 'walletAdminSupportedWalletTypes', method: 'GET', path: '/wallet/admin/supported-wallet-types', auth: AuthMode.ADMIN },
  { key: 'walletAdminCreateExternalWalletType', method: 'POST', path: '/wallet/admin/create-external-wallet-type', auth: AuthMode.ADMIN },
  { key: 'walletAdminUpdateExternalWalletType', method: 'PUT', path: '/wallet/admin/:id/update-external-wallet-type', auth: AuthMode.ADMIN },
  { key: 'walletAdminDeleteExternalWalletTypeWeirdDot', method: 'DELETE', path: '/wallet/admin.:id/delete-external-wallet-type', auth: AuthMode.ADMIN, destructive: true },
  { key: 'walletAdminOverrideExternalWallet', method: 'PUT', path: '/wallet/admin/:walletId/override-external-wallet', auth: AuthMode.ADMIN },
  { key: 'walletAdminDepositsApprove', method: 'POST', path: '/wallet/admin/deposits/:id/approve', auth: AuthMode.ADMIN, financial: true },
  { key: 'walletAdminDepositsReject', method: 'POST', path: '/wallet/admin/deposits/:id/reject', auth: AuthMode.ADMIN, financial: true },
  { key: 'walletAdminWithdrawalsApprove', method: 'POST', path: '/wallet/admin/withdrawal/:id/approve', auth: AuthMode.ADMIN, financial: true },
  { key: 'walletAdminWithdrawalsReject', method: 'POST', path: '/wallet/admin/withdrawal/:id/reject', auth: AuthMode.ADMIN, financial: true },
  { key: 'walletAdminBonusCredit', method: 'POST', path: '/wallet/admin/bonus-credit', auth: AuthMode.ADMIN, financial: true },
  { key: 'walletAdminDeposits', method: 'GET', path: '/wallet/admin/deposits', auth: AuthMode.ADMIN },
  { key: 'walletAdminDepositById', method: 'GET', path: '/wallet/admin/deposits/:id', auth: AuthMode.ADMIN },

  // packages
  { key: 'packagesAdminCreate', method: 'POST', path: '/packages', auth: AuthMode.ADMIN, destructive: true },
  { key: 'packagesAdminUpdate', method: 'PATCH', path: '/packages/:id', auth: AuthMode.ADMIN },
  { key: 'packagesList', method: 'GET', path: '/packages', auth: AuthMode.USER },
  { key: 'packagesPurchase', method: 'POST', path: '/packages/purchase', auth: AuthMode.USER, financial: true },
  { key: 'packagesMy', method: 'GET', path: '/packages/my', auth: AuthMode.USER },
  { key: 'packagesWalletRulesGet', method: 'GET', path: '/packages/wallet-rules', auth: AuthMode.USER },
  { key: 'packagesWalletRulesUpsert', method: 'POST', path: '/packages/wallet-rules', auth: AuthMode.ADMIN },

  // utility
  { key: 'utilityQueriesCreate', method: 'POST', path: '/utility/queries', auth: AuthMode.USER },
  { key: 'utilityQueriesReply', method: 'POST', path: '/utility/queries/:id/reply', auth: AuthMode.ADMIN },
  { key: 'utilityQueriesList', method: 'GET', path: '/utility/queries', auth: AuthMode.USER },
  { key: 'utilityAdminQueriesList', method: 'GET', path: '/utility/admin/queries', auth: AuthMode.ADMIN },
  { key: 'utilityHolidaysList', method: 'GET', path: '/utility/holidays', auth: AuthMode.USER },
  { key: 'utilityHolidaysCreate', method: 'POST', path: '/utility/holidays', auth: AuthMode.ADMIN },
  { key: 'utilityHolidaysUpdate', method: 'PUT', path: '/utility/holidays/:id', auth: AuthMode.ADMIN },
  { key: 'utilityHolidaysDelete', method: 'DELETE', path: '/utility/holidays/:id', auth: AuthMode.ADMIN, destructive: true },

  // targets
  { key: 'targetsAdminList', method: 'GET', path: '/targets', auth: AuthMode.ADMIN },
  { key: 'targetsAdminAssign', method: 'POST', path: '/targets/assign', auth: AuthMode.ADMIN },
  { key: 'targetsAdminUpdate', method: 'PATCH', path: '/targets/:id', auth: AuthMode.ADMIN },
  { key: 'targetsAdminDelete', method: 'DELETE', path: '/targets/:id', auth: AuthMode.ADMIN, destructive: true },
  { key: 'targetsStats', method: 'GET', path: '/targets/stats', auth: AuthMode.ADMIN },
  { key: 'targetsBusinessVolume', method: 'GET', path: '/targets/business-volume', auth: AuthMode.ADMIN },
  { key: 'targetsMy', method: 'GET', path: '/targets/my', auth: AuthMode.USER },

  // tree
  { key: 'treeUser', method: 'GET', path: '/tree/user/:id', auth: AuthMode.PUBLIC },
  { key: 'treeDownlineRecent', method: 'GET', path: '/tree/downline/recent', auth: AuthMode.USER },
  { key: 'treeReferrals', method: 'GET', path: '/tree/referrals', auth: AuthMode.USER },
  { key: 'treeDownlineRank', method: 'GET', path: '/tree/downline/rank', auth: AuthMode.USER },
  { key: 'treeDownlineDepositFunds', method: 'GET', path: '/tree/downline/deposit-funds', auth: AuthMode.USER },
  { key: 'treeSearchMember', method: 'GET', path: '/tree/search/member', auth: AuthMode.USER },
  { key: 'treeSearchExtremeLeft', method: 'GET', path: '/tree/search/extreme-left', auth: AuthMode.USER },
  { key: 'treeSearchExtremeRight', method: 'GET', path: '/tree/search/extreme-right', auth: AuthMode.USER },

  // ranks
  { key: 'ranksList', method: 'GET', path: '/ranks', auth: AuthMode.USER },
  { key: 'ranksUser', method: 'GET', path: '/ranks/user', auth: AuthMode.USER },
  { key: 'ranksClaim', method: 'POST', path: '/ranks/claim/:rankId', auth: AuthMode.USER, financial: true },
  { key: 'ranksProgress', method: 'GET', path: '/ranks/progress', auth: AuthMode.USER },

  // notifications
  { key: 'notificationsGet', method: 'GET', path: '/notifications', auth: AuthMode.USER },
  { key: 'notificationsMarkRead', method: 'PATCH', path: '/notifications/:id/read', auth: AuthMode.USER },
  { key: 'notificationsReadAll', method: 'PATCH', path: '/notifications/read-all', auth: AuthMode.USER },

  // payments callback (signature-verified by NOWPayments IPN secret)
  { key: 'paymentsIpn', method: 'POST', path: '/wallet/payments/ipn', auth: AuthMode.PUBLIC, financial: true },
];

