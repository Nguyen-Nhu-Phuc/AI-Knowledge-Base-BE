export const NotificationTypes = {
  ORG_CREATE_REQUEST: 'org_create_request',
  ORG_CREATE_APPROVED: 'org_create_approved',
  ORG_CREATE_REJECTED: 'org_create_rejected',
  USER_DISABLED: 'user_disabled',
  USER_ENABLED: 'user_enabled',
  SUPER_ADMIN_GRANTED: 'super_admin_granted',
  SUPER_ADMIN_REVOKED: 'super_admin_revoked',
} as const;

export type NotificationType =
  (typeof NotificationTypes)[keyof typeof NotificationTypes];
