import { ScanList } from "../../components/ScanList";

/** Your own region scans. The server pins the list to your account, whatever the page asks for. */
export function ScansSection({ userId }: { userId: number }) {
  return <ScanList userId={userId} />;
}
