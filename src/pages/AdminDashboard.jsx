
import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  Shield,
  Search,
  RefreshCw,
  Activity,
  AlertTriangle,
  Database,
  UserPlus
} from "lucide-react";

import UserManagementTable from "../components/admin/UserManagementTable";
import AdminStats from "../components/admin/AdminStats";
import SystemActivity from "../components/admin/SystemActivity";

export default function AdminDashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const queryClient = useQueryClient();

  // Check if current user is admin
  useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const user = await base44.auth.me();
      setCurrentUser(user);
      
      // Redirect if not admin
      if (user.role !== 'admin') {
        window.location.href = '/';
      }
      
      return user;
    },
  });

  const { data: allUsers = [] } = useQuery({
    queryKey: ['all-users'],
    queryFn: () => base44.entities.User.list(),
    enabled: currentUser?.role === 'admin',
  });

  const { data: portfolios = [] } = useQuery({
    queryKey: ['all-portfolios'],
    queryFn: () => base44.entities.Portfolio.list(),
    enabled: currentUser?.role === 'admin',
  });

  const { data: trades = [] } = useQuery({
    queryKey: ['all-trades'],
    queryFn: () => base44.entities.Trade.list('-created_date', 100),
    enabled: currentUser?.role === 'admin',
  });

  const { data: notifications = [] } = useQuery({
    queryKey: ['all-notifications'],
    queryFn: () => base44.entities.Notification.list('-created_date', 50),
    enabled: currentUser?.role === 'admin',
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.User.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id) => base44.entities.User.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    },
  });

  const handleDeleteUser = async (user) => {
    if (window.confirm(`Are you sure you want to delete user ${user.email}? This action cannot be undone.`)) {
      try {
        await deleteUserMutation.mutateAsync(user.id);
        alert('User deleted successfully');
      } catch (error) {
        alert('Failed to delete user: ' + error.message);
      }
    }
  };

  const handleToggleRole = async (user) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    if (window.confirm(`Change ${user.email} role to ${newRole}?`)) {
      try {
        await updateUserMutation.mutateAsync({
          id: user.id,
          data: { ...user, role: newRole }
        });
        alert('Role updated successfully');
      } catch (error) {
        alert('Failed to update role: ' + error.message);
      }
    }
  };

  const handleResetUserData = async (user) => {
    if (window.confirm(`Reset all trading data for ${user.email}? This will clear their portfolio and trades.`)) {
      try {
        // Find user's portfolio
        const userPortfolio = portfolios.find(p => p.created_by === user.email);
        
        if (userPortfolio) {
          await base44.entities.Portfolio.update(userPortfolio.id, {
            total_balance: 10000,
            available_balance: 10000,
            positions: [],
            total_profit_loss: 0,
            total_trades: 0
          });
        }
        
        alert('User data reset successfully');
        queryClient.invalidateQueries({ queryKey: ['all-portfolios'] });
      } catch (error) {
        alert('Failed to reset user data: ' + error.message);
      }
    }
  };

  const handleInviteUser = () => {
    window.open('/dashboard/users', '_blank');
  };

  const filteredUsers = allUsers.filter(user =>
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.full_name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate stats
  const totalUsers = allUsers.length;
  const adminUsers = allUsers.filter(u => u.role === 'admin').length;
  const activeUsers = allUsers.filter(u => {
    const portfolio = portfolios.find(p => p.created_by === u.email);
    return portfolio && portfolio.total_trades > 0;
  }).length;
  const totalTrades = trades.length;
  const totalVolume = trades.reduce((sum, t) => sum + (t.total_value || 0), 0);

  if (!currentUser || currentUser.role !== 'admin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center">
        <Card className="bg-slate-900 border-red-500/30 max-w-md">
          <CardContent className="pt-6">
            <div className="text-center">
              <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
              <p className="text-slate-400 mb-6">You don't have permission to access the admin dashboard.</p>
              <Button onClick={() => window.location.href = '/'}>
                Go Back Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="max-w-7xl mx-auto px-6 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-orange-600 rounded-2xl flex items-center justify-center">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
                Admin Dashboard
              </h1>
              <p className="text-slate-400">System management and user administration</p>
            </div>
          </div>
        </div>

        <AdminStats
          totalUsers={totalUsers}
          adminUsers={adminUsers}
          activeUsers={activeUsers}
          totalTrades={totalTrades}
          totalVolume={totalVolume}
        />

        {/* Main Content Tabs */}
        <Tabs defaultValue="users" className="mt-8">
          <TabsList className="bg-slate-800 border-slate-700">
            <TabsTrigger value="users" className="data-[state=active]:bg-red-600">
              <Users className="w-4 h-4 mr-2" />
              User Management
            </TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-red-600">
              <Activity className="w-4 h-4 mr-2" />
              System Activity
            </TabsTrigger>
            <TabsTrigger value="database" className="data-[state=active]:bg-red-600">
              <Database className="w-4 h-4 mr-2" />
              Database
            </TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="mt-6">
            {/* Invite User Notice */}
            <Card className="bg-purple-900/30 backdrop-blur-sm border-purple-500/50 mb-6 shadow-lg shadow-purple-500/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 bg-purple-500/30 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-purple-500/30">
                    <UserPlus className="w-6 h-6 text-purple-300" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-purple-100 mb-2 text-lg">Need to Add Users?</h3>
                    <p className="text-purple-200/90 text-sm mb-4 leading-relaxed">
                      Users cannot be created directly. To add new users to your app, use the <strong className="text-purple-100">Invite User</strong> feature 
                      in the Base44 dashboard. Invited users will receive an email and can sign up through the platform.
                    </p>
                    <Button
                      onClick={handleInviteUser}
                      className="bg-purple-600 hover:bg-purple-700 shadow-lg shadow-purple-600/30"
                    >
                      <UserPlus className="w-4 h-4 mr-2" />
                      Open Invite User Page
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-white flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    All Users ({filteredUsers.length})
                  </CardTitle>
                  <div className="flex gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input
                        placeholder="Search users..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-10 bg-slate-800 border-slate-700 text-white w-64"
                      />
                    </div>
                    <Button
                      onClick={() => queryClient.invalidateQueries({ queryKey: ['all-users'] })}
                      variant="outline"
                      className="border-slate-700"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <UserManagementTable
                  users={filteredUsers}
                  portfolios={portfolios}
                  onDeleteUser={handleDeleteUser}
                  onToggleRole={handleToggleRole}
                  onResetData={handleResetUserData}
                  currentUser={currentUser}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Activity Tab */}
          <TabsContent value="activity" className="mt-6">
            <SystemActivity
              trades={trades}
              notifications={notifications}
              users={allUsers}
            />
          </TabsContent>

          {/* Database Tab */}
          <TabsContent value="database" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="bg-slate-900 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">Database Stats</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                      <span className="text-slate-300">Users</span>
                      <Badge className="bg-indigo-500/20 text-indigo-400">{allUsers.length} records</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                      <span className="text-slate-300">Portfolios</span>
                      <Badge className="bg-green-500/20 text-green-400">{portfolios.length} records</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                      <span className="text-slate-300">Trades</span>
                      <Badge className="bg-blue-500/20 text-blue-400">{trades.length} records</Badge>
                    </div>
                    <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                      <span className="text-slate-300">Notifications</span>
                      <Badge className="bg-purple-500/20 text-purple-400">{notifications.length} records</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-white">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <Button
                      onClick={() => queryClient.invalidateQueries()}
                      className="w-full bg-indigo-600 hover:bg-indigo-700"
                    >
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Refresh All Data
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full border-slate-700 text-slate-300"
                      onClick={() => window.open('/dashboard', '_blank')}
                    >
                      <Database className="w-4 h-4 mr-2" />
                      Open Database Console
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
