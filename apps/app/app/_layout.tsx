import { Stack } from "expo-router";
import { AuthProvider } from "@tunely/app/auth/AuthProvider";
import { AuthGate } from "@tunely/app/components/AuthGate";

export default function RootLayout() {
  return (
    <AuthProvider>
      <AuthGate>
        <Stack
          screenOptions={{
            headerShown: false
          }}
        />
      </AuthGate>
    </AuthProvider>
  );
}
