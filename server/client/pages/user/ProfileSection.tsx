import { when } from "../../lib/format";
import type { Account } from "../../api";

const ROLE_LABEL: Record<string, string> = { admin: "Admin", contributor: "Contributor", reader: "Reader" };

const ROLE_HINT: Record<string, string> = {
  admin: "You manage accounts, server settings and everyone's sessions.",
  contributor: "You can build the library and work in the Studio.",
  reader: "You can read what has been published.",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5">
      <dt className="w-32 shrink-0 text-xs text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-200">{children}</dd>
    </div>
  );
}

/** Who this account is, as the server sees it. An admin changes any of it from the Server area. */
export function ProfileSection({ account }: { account: Account }) {
  return (
    <div className="max-w-2xl overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
      <dl className="divide-y divide-gray-800">
        <Row label="Username">{account.username}</Row>
        <Row label="Display name">
          {account.display_name ?? <span className="text-gray-500">not set</span>}
        </Row>
        <Row label="Email">{account.email ?? <span className="text-gray-500">not set</span>}</Row>
        <Row label="Role">
          {ROLE_LABEL[account.role] ?? account.role}
          <span className="ml-2 text-xs text-gray-500">{ROLE_HINT[account.role]}</span>
        </Row>
        <Row label="Account made">{when(account.created_at)}</Row>
        <Row label="Last seen">{when(account.last_seen_at)}</Row>
      </dl>
    </div>
  );
}
