export default function AuthLoadingScreen({
  message = "Oturum kontrol ediliyor...",
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white">
      <div className="flex flex-col items-center gap-4 px-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-gray-700 border-t-blue-400" />
        <p className="text-sm text-gray-400">{message}</p>
      </div>
    </main>
  );
}
