import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Shield, User, Trash2, RefreshCw, Mail, Calendar } from "lucide-react";
import { motion } from "framer-motion";

export default function UserManagementTable({ 
  users, 
  portfolios, 
  onDeleteUser, 
  onToggleRole, 
  onResetData,
  currentUser 
}) {
  
  const getUserStats = (user) => {
    const portfolio = portfolios.find(p => p.created_by === user.email);
    return {
      balance: portfolio?.total_balance || 0,
      trades: portfolio?.total_trades || 0,
      profitLoss: portfolio?.total_profit_loss || 0
    };
  };

  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-800 border-slate-700 hover:bg-slate-800">
            <TableHead className="text-slate-300">User</TableHead>
            <TableHead className="text-slate-300">Role</TableHead>
            <TableHead className="text-slate-300">Joined</TableHead>
            <TableHead className="text-slate-300">Portfolio</TableHead>
            <TableHead className="text-slate-300">Trades</TableHead>
            <TableHead className="text-slate-300">P&L</TableHead>
            <TableHead className="text-slate-300 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-8 text-slate-400">
                No users found
              </TableCell>
            </TableRow>
          ) : (
            users.map((user, idx) => {
              const stats = getUserStats(user);
              const isCurrentUser = user.email === currentUser?.email;
              
              return (
                <motion.tr
                  key={user.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="border-slate-700 hover:bg-slate-800/50"
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
                        <User className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-white">
                          {user.full_name || 'N/A'}
                          {isCurrentUser && (
                            <Badge className="ml-2 bg-blue-500/20 text-blue-400 text-xs">
                              You
                            </Badge>
                          )}
                        </p>
                        <p className="text-sm text-slate-400 flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {user.email}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  
                  <TableCell>
                    <Badge 
                      className={user.role === 'admin' 
                        ? 'bg-red-500/20 text-red-400 border-red-500/30' 
                        : 'bg-slate-500/20 text-slate-400 border-slate-500/30'
                      }
                    >
                      {user.role === 'admin' ? (
                        <>
                          <Shield className="w-3 h-3 mr-1" />
                          Admin
                        </>
                      ) : (
                        <>
                          <User className="w-3 h-3 mr-1" />
                          User
                        </>
                      )}
                    </Badge>
                  </TableCell>
                  
                  <TableCell>
                    <div className="flex items-center gap-1 text-slate-400 text-sm">
                      <Calendar className="w-3 h-3" />
                      {new Date(user.created_date).toLocaleDateString()}
                    </div>
                  </TableCell>
                  
                  <TableCell>
                    <span className="text-white font-semibold">
                      ${stats.balance.toLocaleString()}
                    </span>
                  </TableCell>
                  
                  <TableCell>
                    <span className="text-slate-300">{stats.trades}</span>
                  </TableCell>
                  
                  <TableCell>
                    <span className={stats.profitLoss >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {stats.profitLoss >= 0 ? '+' : ''}${stats.profitLoss.toLocaleString()}
                    </span>
                  </TableCell>
                  
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!isCurrentUser && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onToggleRole(user)}
                            className="border-slate-700 text-slate-300 hover:bg-slate-700"
                            title={`Change to ${user.role === 'admin' ? 'user' : 'admin'}`}
                          >
                            <Shield className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onResetData(user)}
                            className="border-yellow-500 text-yellow-400 hover:bg-yellow-500/10"
                            title="Reset trading data"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </Button>
                          
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onDeleteUser(user)}
                            className="border-red-500 text-red-400 hover:bg-red-500/10"
                            title="Delete user"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      {isCurrentUser && (
                        <Badge className="bg-blue-500/20 text-blue-400">
                          Current User
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                </motion.tr>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}