import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "./components/utils";
import { base44 } from "@/api/base44Client";
import { TrendingUp, History, Settings, LogOut, User, Sparkles, Bell, Shield, Activity, Brain } from "lucide-react";
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
    { name: "AI Signals", path: "AISignals", icon: Brain },
    { name: "AI Insights", path: "Insights", icon: Activity },
    { name: "Backtesting", path: "Backtesting", icon: Activity },
    { name: "Alerts", path: "Alerts", icon: Bell },
    { name: "Trade History", path: "TradeHistory", icon: History },
    { name: "Exchange Settings", path: "ExchangeSettings", icon: Settings }
  ];

  // Add admin dashboard to nav if user is admin
  if (user?.role === 'admin') {
    navItems.push({ name: "Admin", path: "AdminDashboard", icon: Shield });
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Top Navigation */}
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-lg sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <Link to={createPageUrl('Trading')} className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                  <path d="m2 17 10 5 10-5"></path>
                  <path d="m2 12 10 5 10-5"></path>
                </svg>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-white font-semibold">CryptoMate</span>
                <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                  DEMO
                </Badge>
              </div>
            </Link>

            <div className="flex items-center gap-6">
              {/* Navigation Links */}
              <div className="hidden md:flex items-center gap-1">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPageName === item.path;
                  const isAdmin = item.path === 'AdminDashboard';
                  
                  return (
                    <Link
                      key={item.path}
                      to={createPageUrl(item.path)}
                      className={`px-4 py-2 rounded-xl transition-all duration-300 flex items-center gap-2 ${
                        isActive
                          ? isAdmin 
                            ? 'bg-red-600 text-white' 
                            : 'bg-indigo-600 text-white'
                          : isAdmin
                          ? 'text-red-400 hover:text-white hover:bg-red-600/20'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{item.name}</span>
                    </Link>
                  );
                })}
              </div>

              {/* Notification Center */}
              <NotificationCenter />

              {/* User Menu */}
              {user && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="flex items-center gap-2 text-slate-300 hover:text-white">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
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
                      <span className="hidden md:inline">{user.full_name || user.email}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-56 bg-slate-900 border-slate-700" align="end">
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
          </div>

          {/* Mobile Navigation */}
          <div className="md:hidden border-t border-slate-800 py-2">
            <div className="flex justify-around">
              {navItems.slice(0, 5).map((item) => { // Only show first 5 items on mobile, excluding potential Admin link
                const Icon = item.icon;
                const isActive = currentPageName === item.path;
                return (
                  <Link
                    key={item.path}
                    to={createPageUrl(item.path)}
                    className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-300 ${
                      isActive
                        ? 'text-indigo-400'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-xs">{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main>{children}</main>

      {/* Footer Disclaimer */}
      <footer className="border-t border-slate-800 bg-slate-900/50 mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="max-w-2xl">
              <p className="text-slate-400 text-sm leading-relaxed">
                <strong className="text-slate-300">Educational Demo Platform:</strong> This is a paper trading simulation for learning purposes. 
                All trades use virtual funds. No real money is involved. Exchange integrations and auto-trading are demonstration features only.
              </p>
            </div>
            <div className="text-slate-500 text-sm">
              © 2024 CryptoMate Demo
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}