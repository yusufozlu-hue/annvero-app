export default function LoginPage() {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        
        <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-zinc-900 p-10">
          
          <h1 className="text-3xl font-bold text-center">
            ANNVERO
          </h1>
  
          <p className="mt-2 text-center text-gray-400">
            Platform Girişi
          </p>
  
          <div className="mt-8 flex flex-col gap-4">
            
            <input
              type="email"
              placeholder="E-posta"
              className="rounded-xl border border-gray-700 bg-black px-4 py-3 outline-none"
            />
  
            <input
              type="password"
              placeholder="Şifre"
              className="rounded-xl border border-gray-700 bg-black px-4 py-3 outline-none"
            />
  
  <a
  href="/dashboard"
  className="mt-4 rounded-xl bg-white py-3 text-center text-black font-semibold"
>
  Giriş Yap
</a>
  
          </div>
  
        </div>
  
      </main>
    );
  }