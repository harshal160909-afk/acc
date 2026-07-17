import { AccApp } from "./components/AccApp";
import { getServerIdentity } from "./lib/server/access";

export default async function Home() {
  // A returning visitor already carries a valid session cookie and loads
  // straight into their private workspace. A first-time visitor has no session
  // and sees the landing with a single "Open ACC" step. No Google redirect.
  const identity = await getServerIdentity();
  return (
    <AccApp
      initialIdentity={identity
        ? { displayName: identity.displayName, accessMode: identity.accessMode, optionalContactEmail: identity.optionalContactEmail }
        : null}
    />
  );
}
