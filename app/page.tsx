import { AccApp } from "./components/AccApp";
import { getServerIdentity } from "./lib/server/auth";

export default async function Home() {
  const user = await getServerIdentity();
  return (
    <AccApp
      authenticatedUser={user ? { displayName: user.displayName, email: user.email } : null}
      signInPath="/auth/google/start?return_to=%2F"
      signOutPath="/auth/signout"
    />
  );
}
