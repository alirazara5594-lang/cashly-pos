import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Store,
  User,
  Mail,
  Phone,
  MapPin,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { posApi } from '../services/api';

export const TenantSignup: React.FC = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    restaurantName: '',
    contactName: '',
    email: '',
    phone: '',
    city: '',
    address: '',
    adminUsername: '',
    adminPin: '',
    adminPinConfirm: ''
  });

  const update = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateStep1 = () => {
    if (!form.restaurantName.trim()) return setError('Restaurant name is required');
    if (!form.contactName.trim()) return setError('Your name is required');
    if (!form.email.trim() || !form.email.includes('@')) return setError('Valid email is required');
    if (!form.phone.trim()) return setError('Phone number is required');
    return true;
  };

  const validateStep2 = () => {
    if (!form.adminUsername.trim()) return setError('Username is required');
    if (form.adminUsername.length < 3) return setError('Username must be at least 3 characters');
    if (!form.adminPin || form.adminPin.length !== 4) return setError('PIN must be exactly 4 digits');
    if (form.adminPin !== form.adminPinConfirm) return setError('PINs do not match');
    return true;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) setStep(2);
    if (step === 2 && validateStep2()) setStep(3);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    try {
      await posApi.signup({
        restaurantName: form.restaurantName.trim(),
        contactName: form.contactName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        adminUsername: form.adminUsername.trim().toLowerCase(),
        adminPin: form.adminPin
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-white mb-2">Restaurant Created!</h1>
            <p className="text-sm text-slate-400">
              <span className="font-bold text-white">{form.restaurantName}</span> is now live on Cashly POS.
            </p>
            <p className="text-xs text-slate-500 mt-2">
              Your 30-day free trial has started. No credit card required.
            </p>
          </div>
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-left space-y-2">
            <div className="text-xs text-slate-400">Login credentials:</div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">Username</span>
              <span className="text-xs text-white font-mono font-bold">{form.adminUsername}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-xs text-slate-500">PIN</span>
              <span className="text-xs text-white font-mono font-bold">{form.adminPin}</span>
            </div>
          </div>
          <button
            onClick={() => navigate('/')}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition"
          >
            Open POS Terminal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center mx-auto">
            <Store className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black text-white">Register Your Restaurant</h1>
          <p className="text-sm text-slate-400">Start your 30-day free trial. No credit card required.</p>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 justify-center">
          {[1, 2, 3].map(s => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${
                step >= s ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-500'
              }`}>{s}</div>
              {s < 3 && <div className={`w-8 h-0.5 ${step > s ? 'bg-blue-600' : 'bg-slate-800'}`} />}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-red-950 border border-red-800 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Restaurant Info */}
        {step === 1 && (
          <div className="space-y-4 p-5 rounded-2xl bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-black text-white uppercase tracking-wider">Restaurant Details</h2>

            <div className="relative">
              <Store className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={form.restaurantName}
                onChange={(e) => update('restaurantName', e.target.value)}
                placeholder="Restaurant name"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={form.contactName}
                onChange={(e) => update('contactName', e.target.value)}
                placeholder="Your full name"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="Email address"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="Phone number (e.g. 0300-1234567)"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  placeholder="City"
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <input
                value={form.address}
                onChange={(e) => update('address', e.target.value)}
                placeholder="Address (optional)"
                className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              onClick={handleNext}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition flex items-center justify-center gap-2"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 2: Admin Account */}
        {step === 2 && (
          <div className="space-y-4 p-5 rounded-2xl bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-black text-white uppercase tracking-wider">Admin Login Setup</h2>
            <p className="text-xs text-slate-400">This is the login you'll use to access Owner/Admin mode.</p>

            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                value={form.adminUsername}
                onChange={(e) => update('adminUsername', e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                placeholder="Admin username (e.g. myrestaurant)"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                maxLength={4}
                value={form.adminPin}
                onChange={(e) => update('adminPin', e.target.value.replace(/\D/g, ''))}
                placeholder="4-digit PIN"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono tracking-[0.5em]"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="password"
                maxLength={4}
                value={form.adminPinConfirm}
                onChange={(e) => update('adminPinConfirm', e.target.value.replace(/\D/g, ''))}
                placeholder="Confirm 4-digit PIN"
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-mono tracking-[0.5em]"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Create */}
        {step === 3 && (
          <div className="space-y-4 p-5 rounded-2xl bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-black text-white uppercase tracking-wider">Review & Create</h2>

            <div className="space-y-2">
              {[
                { label: 'Restaurant', value: form.restaurantName },
                { label: 'Contact', value: form.contactName },
                { label: 'Email', value: form.email },
                { label: 'Phone', value: form.phone },
                { label: 'City', value: form.city || 'Islamabad' },
                { label: 'Admin Username', value: form.adminUsername },
                { label: 'Admin PIN', value: '••••' }
              ].map((item, i) => (
                <div key={i} className="flex justify-between py-1.5 border-b border-slate-800 last:border-0">
                  <span className="text-xs text-slate-500">{item.label}</span>
                  <span className="text-xs text-white font-semibold">{item.value}</span>
                </div>
              ))}
            </div>

            <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-800/40 text-xs text-blue-300">
              <strong>Free Trial:</strong> 30 days, all features included. No credit card required.
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm transition"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Create Restaurant
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center">
          <button
            onClick={() => navigate('/')}
            className="text-xs text-slate-500 hover:text-slate-300 transition"
          >
            Already have an account? Login
          </button>
        </div>
      </div>
    </div>
  );
};
