/** Site accounts are independent of administrator identities. Registration is closed. */
export interface SiteUser {
  id: number;
  username: string;
  displayName: string;
  role: "member";
  status: "active" | "disabled";
  createdAt: string;
  lastLoginAt: string | null;
}

export interface AccountMe {
  user: SiteUser;
  csrf: string;
}

export interface SiteUsersPage {
  users: SiteUser[];
  nextCursor: number | null;
}
