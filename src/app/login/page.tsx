import { LoginForm } from "@/components/auth/login-form";
import { SessionRestorer } from "@/components/auth/session-restorer";

export default function LoginPage() {
  return (
    <>
      <SessionRestorer />
      <LoginForm />
    </>
  );
}
