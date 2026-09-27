import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./components/utils";
import { base44 } from "@/api/base44Client";
import { TrendingUp, History, Settings, LogOut, User, Sparkles, Bell, Shield, Activity, Brain, Target, Scan, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import NotificationCenter from "./components/notifications/NotificationCenter";

export default function Layout({ children, currentPageName }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      // First check if user is authenticated
      const isAuthenticated = await base44.auth.isAuthenticated();
      
      if (!isAuthenticated) {
        // If not authenticated and not on home page, redirect to home
        if (currentPageName !== 'Home') {
          window.location.href = createPageUrl('Home');
        }
        setIsLoading(false);
        return;
      }
      
      // If authenticated, fetch user data
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch (error) {
      console.error("Failed to load user:", error);
      // If there's an error and we're not on home page, redirect to home
      if (currentPageName !== 'Home') {
        window.location.href = createPageUrl('Home');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    base44.auth.logout(createPageUrl('Home'));
  };

  // Don't show navigation on Home page (landing page)
  if (currentPageName === 'Home') {
    return <main>{children}</main>;
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  // If not authenticated and not loading, don't render (will redirect)
  if (!user && !isLoading) {
    return null;
  }

  const navItems = [
    { name: "Trading", path: "Trading", icon: TrendingUp },
    { name: "Auto-Trading", path: "AutoTrading", icon: Sparkles },
    { name: "Trade Signals", path: "TradeSignals", icon: Target },
    { name: "Altcoin Scanner", path: "AltcoinScanner", icon: Scan },
    { name: "AI Signals", path: "AISignals", icon: Brain },
    { name: "AI Insights", path: "Insights", icon: Activity },
    { name: "Backtesting", path: "Backtesting", icon: Activity },
    { name: "Alerts", path: "Alerts", icon: Bell },
    { name: "Trade History", path: "TradeHistory", icon: History },
    { name: "Exchange Settings", path: "ExchangeSettings", icon: Settings },
    { name: "AI Settings", path: "AISettings", icon: Cpu }
  ];

  // Add admin dashboard to nav if user is admin
  if (user?.role === 'admin') {
    navItems.push({ name: "Admin", path: "AdminDashboard", icon: Shield });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex">
      {/* Sidebar */}
      <aside
        className={`fixed md:sticky top-0 left-0 z-50 h-screen w-64 flex-shrink-0 border-r border-slate-800 bg-slate-900/80 backdrop-blur-lg flex flex-col transition-transform duration-300 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        {/* Logo */}
        <Link
          to={createPageUrl('Trading')}
          className="flex items-center gap-3 px-5 h-16 border-b border-slate-800 flex-shrink-0"
          onClick={() => setMobileOpen(false)}
        >
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="m2 17 10 5 10-5"></path>
              <path d="m2 12 10 5 10-5"></path>
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-white font-semibold leading-tight">CryptoMate</span>
            <span className="text-[10px] text-slate-400 leading-tight">Your Crypto Trading Assistant</span>
          </div>
        </Link>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPageName === item.path;
            const isAdmin = item.path === 'AdminDashboard';

            return (
              <Link
                key={item.path}
                to={createPageUrl(item.path)}
                onClick={() => setMobileOpen(false)}
                className={`px-3 py-2.5 rounded-xl transition-all duration-300 flex items-center gap-3 text-sm ${
                  isActive
                    ? isAdmin
                      ? 'bg-red-600 text-white'
                      : 'bg-indigo-600 text-white'
                    : isAdmin
                    ? 'text-red-400 hover:text-white hover:bg-red-600/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* Bottom: Notifications + User Menu */}
        <div className="border-t border-slate-800 p-3 space-y-2 flex-shrink-0">
          <div className="px-1">
            <NotificationCenter />
          </div>

          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full flex items-center gap-2 text-slate-300 hover:text-white justify-start px-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    user.role === 'admin'
                      ? 'bg-gradient-to-br from-red-500 to-orange-600'
                      : 'bg-gradient-to-br from-indigo-500 to-purple-600'
                  }`}>
                    {user.role === 'admin' ? (
                      <Shield className="w-4 h-4 text-white" />
                    ) : (
                      <User className="w-4 h-4 text-white" />
                    )}
                  </div>
                  <span className="text-sm truncate">{user.full_name || user.email}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 bg-slate-900 border-slate-700" align="start" side="top">
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-white flex items-center gap-2">
                    {user.full_name || 'User'}
                    {user.role === 'admin' && (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                        Admin
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-slate-400">{user.email}</p>
                </div>
                <DropdownMenuSeparator className="bg-slate-700" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between h-16 px-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-lg">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
            aria-label="Open menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <Link to={createPageUrl('Trading')} className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                <path d="m2 17 10 5 10-5"></path>
                <path d="m2 12 10 5 10-5"></path>
              </svg>
            </div>
            <span className="text-white font-semibold text-sm">CryptoMate</span>
          </Link>
          <div className="w-10" />
        </div>

        {/* Main Content */}
        <main className="flex-1">{children}</main>

        {/* Footer Disclaimer */}
        <footer className="border-t border-slate-800 bg-slate-900/50 mt-20">
          <div className="max-w-7xl mx-auto px-6 py-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="max-w-2xl">
                <p className="text-slate-400 text-sm leading-relaxed">
                  <strong className="text-slate-300">Educational Platform:</strong> This is a paper trading simulation for learning purposes.
                  All trades use virtual funds. No real money is involved. Exchange integrations and auto-trading are demonstration features only.
                </p>
              </div>
              <div className="text-slate-500 text-sm">
                © 2024 CryptoMate
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}