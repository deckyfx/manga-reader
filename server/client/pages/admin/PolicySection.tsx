import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getServerPolicy, updateServerPolicy, type RegistrationRole } from "../../api";
import { fieldClass } from "../../lib/styles";
import { Toggle } from "../../components/Toggle";
import { useAuth } from "../../auth/AuthProvider";

/** Self-registration can't mint admins, so the default-role picker doesn't offer it. */
const REGISTRATION_ROLES: RegistrationRole[] = ["contributor", "reader"];

/** Who may join this server, and what they start as. */
export function PolicySection() {
  const qc = useQueryClient();
  const policyQ = useQuery({ queryKey: ["server-policy"], queryFn: getServerPolicy });
  const { refresh: refreshAccount } = useAuth();
  const saveM = useMutation({
    mutationFn: (changes: { registration_enabled?: boolean; default_role?: RegistrationRole }) => updateServerPolicy(changes),
    onSuccess: (policy) => {
      qc.setQueryData(["server-policy"], policy);
      // The sign-in screen offers "create an account" based on this
      void refreshAccount();
    },
  });

  const policy = policyQ.data;

  return (
    <div>
      {policyQ.isError ? (
        <p className="text-sm text-red-400">These settings couldn't be read: {policyQ.error.message}</p>
      ) : policyQ.isLoading || !policy ? (
        <Loader2 size={16} className="animate-spin text-gray-500" />
      ) : (
        <div className="flex flex-wrap items-center gap-6">
          <Toggle
            checked={policy.registration_enabled}
            onChange={(on) => saveM.mutate({ registration_enabled: on })}
            disabled={saveM.isPending}
            className="text-sm text-gray-300"
          >
            Let people create their own accounts
          </Toggle>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            New accounts start as
            <select
              value={policy.default_role}
              onChange={(e) => saveM.mutate({ default_role: e.target.value as RegistrationRole })}
              disabled={saveM.isPending || !policy.registration_enabled}
              title="Anyone who signs up gets this; admins are made here, one at a time"
              className={fieldClass}
            >
              {REGISTRATION_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          {saveM.isPending && <Loader2 size={14} className="animate-spin text-gray-500" />}
        </div>
      )}
      {saveM.error && <p className="mt-2 text-sm text-red-400">{saveM.error.message}</p>}
    </div>
  );
}
