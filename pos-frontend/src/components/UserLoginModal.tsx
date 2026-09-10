import React, { useState } from 'react';
import { User, LogOut, Key } from 'lucide-react';
import { posApi } from '../services/api';

interface UserLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLogin: (user: any) => void;
  onLogout: () => void;
  currentUser: any;
}

export const UserLoginModal: React.FC<UserLoginModalProps> = ({
  isOpen,
  onClose,
  onLogin,
  onLogout,
  currentUser
}) => {
  const [username, setUsername] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !pinCode) {
      setError('Enter username and PIN');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const result = await posApi.login(username, pinCode);
      if (result.user) {
        onLogin(result.user);
        setUsername('');
        setPinCode('');
        onClose();
      } else {
        setError('Invalid credentials');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    posApi.logout();
    onLogout();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="font-bold text-white text-base flex items-center gap-2">
            <User className="w-5 h-5 text-emerald-400" />
            User Login
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm cursor-pointer">✕</button>
        </div>

        {currentUser ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800">
              <div className="text-xs text-emerald-300 font-bold">Logged in as:</div>
              <div className="text-sm font-black text-white mt-1">{currentUser.fullName || currentUser.username}</div>
              <div className="text-[10px] text-emerald-400 mt-0.5">{currentUser.role}</div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Switch User (Logout)
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 font-medium mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                placeholder="Enter username"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 font-medium mb-1">PIN Code</label>
              <input
                type="password"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                placeholder="Enter 4-digit PIN"
                maxLength={6}
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-xl bg-red-950/50 text-red-400 border border-red-800 text-xs font-semibold">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !pinCode}
              className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-2"
            >
              {loading ? 'Logging in...' : (
                <>
                  <Key className="w-4 h-4" />
                  Login
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
