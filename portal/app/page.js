"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const PORTAL_NAME = process.env.NEXT_PUBLIC_PORTAL_NAME || "Free WiFi";

function LoginForm() {
  const searchParams = useSearchParams();

  // ─── Aruba Instant On redirect parameters ───
  // When Aruba redirects to external captive portal, it passes these:
  const [arubaParams, setArubaParams] = useState({
    cmd: "",           // login, logout
    mac: "",           // Client MAC address
    essid: "",         // SSID name
    ip: "",            // Client IP
    apname: "",        // AP name
    apmac: "",         // AP MAC
    vcname: "",        // Virtual controller name
    switchip: "",      // Switch/Controller IP
    url: "",           // Original URL the user tried to visit
    loginurl: "",      // URL to POST credentials back to Aruba
  });

  const [authMethod, setAuthMethod] = useState("email"); // email | phone | click
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [locationInfo, setLocationInfo] = useState(null);

  useEffect(() => {
    // Parse Aruba redirect parameters from URL
    const params = {
      cmd: searchParams.get("cmd") || "",
      mac: searchParams.get("mac") || searchParams.get("client_mac") || "",
      essid: searchParams.get("essid") || searchParams.get("ssid") || "",
      ip: searchParams.get("ip") || searchParams.get("client_ip") || "",
      apname: searchParams.get("apname") || "",
      apmac: searchParams.get("apmac") || searchParams.get("ap_mac") || "",
      vcname: searchParams.get("vcname") || "",
      switchip: searchParams.get("switchip") || searchParams.get("switch_url") || "",
      url: searchParams.get("url") || searchParams.get("redirect_url") || "",
      loginurl: searchParams.get("loginurl") || searchParams.get("login_url") || "",
    };
    setArubaParams(params);

    // Fetch location info
    fetchLocationInfo();
  }, [searchParams]);

  const fetchLocationInfo = async () => {
    try {
      const res = await fetch(`${API_URL}/api/location/1`);
      if (res.ok) {
        const data = await res.json();
        setLocationInfo(data);
      }
    } catch (e) {
      console.log("Could not fetch location info");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Step 1: Register guest with our API
      const res = await fetch(`${API_URL}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mac_address: arubaParams.mac || "00:00:00:00:00:00",
          email: authMethod === "email" ? email : undefined,
          phone: authMethod === "phone" ? phone : undefined,
          name: name || undefined,
          auth_method: authMethod,
          ap_mac: arubaParams.apmac,
          aruba_url: arubaParams.loginurl,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      setSuccess(true);

      // Step 2: Redirect to Aruba login URL with credentials
      // Aruba Instant On expects a form POST to its login URL
      if (arubaParams.loginurl) {
        // Create a hidden form and submit to Aruba
        const form = document.createElement("form");
        form.method = "POST";
        form.action = arubaParams.loginurl;

        const addField = (name, value) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = name;
          input.value = value;
          form.appendChild(input);
        };

        addField("user", data.data.username);
        addField("password", data.data.password);
        addField("cmd", "authenticate");
        addField("Login", "Log In");

        document.body.appendChild(form);

        setTimeout(() => {
          form.submit();
        }, 1500);
      } else {
        // No Aruba URL — likely testing mode
        // Redirect to the original URL or a default
        setTimeout(() => {
          const redirectUrl = data.data.redirect_url || arubaParams.url || "https://google.com";
          window.location.href = redirectUrl;
        }, 2000);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleClickThrough = async () => {
    setAuthMethod("click");
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/auth/guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mac_address: arubaParams.mac || "00:00:00:00:00:00",
          auth_method: "click-through",
          ap_mac: arubaParams.apmac,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess(true);

      if (arubaParams.loginurl) {
        const form = document.createElement("form");
        form.method = "POST";
        form.action = arubaParams.loginurl;

        const addField = (n, v) => {
          const i = document.createElement("input");
          i.type = "hidden"; i.name = n; i.value = v;
          form.appendChild(i);
        };

        addField("user", data.data.username);
        addField("password", data.data.password);
        addField("cmd", "authenticate");

        document.body.appendChild(form);
        setTimeout(() => form.submit(), 1500);
      } else {
        setTimeout(() => {
          window.location.href = data.data.redirect_url || "https://google.com";
        }, 2000);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Success Screen ───
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "linear-gradient(145deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}>
        <div className="w-full max-w-sm text-center">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
            <svg className="w-10 h-10 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Connected!</h2>
          <p className="text-slate-400">You're now online. Redirecting you...</p>
          <div className="mt-6">
            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full animate-pulse" style={{ width: "60%", animation: "grow 2s ease-in-out forwards" }}></div>
            </div>
          </div>
        </div>
        <style jsx>{`
          @keyframes grow {
            from { width: 0%; }
            to { width: 100%; }
          }
        `}</style>
      </div>
    );
  }

  // ─── Main Login Screen ───
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(145deg, #0F172A 0%, #1E293B 50%, #0F172A 100%)" }}>
      {/* WiFi icon pattern background */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-10 left-10 w-32 h-32 border-2 border-white rounded-full"></div>
        <div className="absolute top-20 right-20 w-20 h-20 border border-white rounded-full"></div>
        <div className="absolute bottom-32 left-1/4 w-16 h-16 border border-white rounded-full"></div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        <div className="w-full max-w-sm">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-blue-600/30">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-1">
              {locationInfo?.name || PORTAL_NAME}
            </h1>
            <p className="text-slate-400 text-sm">
              {locationInfo?.splash_message || "Connect to free WiFi"}
            </p>
            {arubaParams.essid && (
              <p className="text-slate-500 text-xs mt-1">
                Network: {arubaParams.essid}
              </p>
            )}
          </div>

          {/* Login Card */}
          <div className="bg-slate-800/50 backdrop-blur-xl border border-slate-700/50 rounded-2xl p-6 shadow-2xl">
            {/* Auth Method Tabs */}
            <div className="flex gap-1 p-1 bg-slate-900/50 rounded-xl mb-6">
              {[
                { key: "email", label: "Email" },
                { key: "phone", label: "Phone" },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setAuthMethod(tab.key)}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                    authMethod === tab.key
                      ? "bg-blue-600 text-white shadow-md"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {authMethod === "email" && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm"
                  />
                </div>
              )}

              {authMethod === "phone" && (
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5 ml-1">Phone number</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    required
                    className="w-full px-4 py-3 bg-slate-900/50 border border-slate-600/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all text-sm"
                  />
                </div>
              )}

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-2.5 rounded-xl">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-600/25 text-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Connecting...
                  </span>
                ) : (
                  "Connect to WiFi"
                )}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-slate-700/50"></div>
              <span className="text-xs text-slate-500">or</span>
              <div className="flex-1 h-px bg-slate-700/50"></div>
            </div>

            {/* Click-through option */}
            <button
              onClick={handleClickThrough}
              disabled={loading}
              className="w-full py-3 bg-transparent border border-slate-600/50 text-slate-300 hover:text-white hover:border-slate-500 font-medium rounded-xl transition-all text-sm"
            >
              Continue as Guest
            </button>
          </div>

          {/* Terms */}
          <p className="text-center text-xs text-slate-500 mt-5 px-4">
            By connecting, you agree to our{" "}
            <a href={locationInfo?.terms_url || "#"} className="text-blue-400 hover:underline">
              Terms of Service
            </a>{" "}
            and{" "}
            <a href="#" className="text-blue-400 hover:underline">
              Privacy Policy
            </a>
          </p>

          {/* Debug info (remove in production) */}
          {process.env.NODE_ENV === "development" && arubaParams.mac && (
            <details className="mt-6 text-xs text-slate-600">
              <summary className="cursor-pointer">Debug: Aruba Params</summary>
              <pre className="mt-2 p-3 bg-slate-900 rounded-lg overflow-x-auto">
                {JSON.stringify(arubaParams, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="text-center py-4 relative z-10">
        <p className="text-xs text-slate-600">
          Powered by Captive Portal
        </p>
      </div>
    </div>
  );
}

// Wrap in Suspense for useSearchParams
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0F172A" }}>
        <div className="animate-spin h-8 w-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
