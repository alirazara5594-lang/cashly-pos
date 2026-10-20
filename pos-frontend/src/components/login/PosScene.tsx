import { useEffect, useRef, useState } from 'react';
import { BarChart3, Bell, ClipboardList, LayoutDashboard, Package, Search, Settings, ShoppingCart, Users } from 'lucide-react';

// The sign-in page's picture: a Cashly till on a shop counter — the touchscreen on its
// stand and base, the receipt printer beside it, café lights behind. Drawn at 560×480;
// ScaledPosScene fits it to the width it is given.
const SCENE_WIDTH = 560;

const MENU = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: ShoppingCart, label: 'Sales' },
  { icon: Package, label: 'Inventory' },
  { icon: Users, label: 'Customers' },
  { icon: BarChart3, label: 'Reports' },
  { icon: Settings, label: 'Settings' }
];

const STATS = [
  { icon: ShoppingCart, label: 'Total sales', value: 'Rs 84,250', change: '+12.5%', tone: 'bg-emerald-50', chip: 'bg-emerald-500' },
  { icon: ClipboardList, label: 'Total orders', value: '845', change: '+8.2%', tone: 'bg-indigo-50', chip: 'bg-indigo-500' },
  { icon: Users, label: 'Customers', value: '3,250', change: '+5.1%', tone: 'bg-orange-50', chip: 'bg-orange-400' }
];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SALES_LINE = 'M0 78 C 15 72, 25 60, 40 62 C 55 64, 65 74, 80 70 C 95 66, 105 40, 120 40 C 135 40, 145 58, 160 55 C 175 52, 185 40, 200 38 C 215 36, 228 22, 240 14';

// A café pendant lamp, out of focus behind the counter: a brushed metal shade, the warm light
// on its lip, and the cone of light it throws down onto the counter.
function Lamp({ className, size, blur }: { className: string; size: number; blur: string }) {
  return (
    <div className={`absolute ${className}`} style={{ transform: `scale(${size})`, filter: `blur(${blur})` }}>
      {/* The light thrown down onto the counter. */}
      <div className="absolute left-1/2 -translate-x-1/2 top-[36px] w-[210px] h-[280px] [clip-path:polygon(40%_0,60%_0,98%_100%,2%_100%)] bg-[linear-gradient(to_bottom,rgba(253,230,138,0.28),rgba(253,230,138,0.08)_55%,transparent)] blur-[5px]" />
      {/* The cord, up out of frame. */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-[1.5px] h-[520px] bg-gradient-to-b from-transparent via-white/15 to-white/30" />
      {/* The shade: brushed metal, warm light on its lip. */}
      <div className="relative w-[78px] h-[40px] rounded-t-[46px] rounded-b-[5px] bg-gradient-to-b from-[#44605b] via-[#1f3a36] to-[#0f2724] shadow-[inset_0_1.5px_1px_rgba(255,255,255,0.28),inset_0_-6px_10px_rgba(0,0,0,0.45),0_8px_18px_-6px_rgba(0,0,0,0.55)]">
        <span className="absolute left-3 top-[5px] w-[24px] h-[8px] rounded-[50%] bg-white/15 blur-[1px]" />
      </div>
      {/* The lit opening under the shade. */}
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-[4px] w-[62px] h-[12px] rounded-[50%] bg-gradient-to-b from-[#fde68a] to-[#fbbf24] shadow-[0_0_16px_3px_rgba(252,211,77,0.5)]" />
      {/* The soft glow just below it. */}
      <div className="absolute left-1/2 -translate-x-1/2 top-[40px] w-[90px] h-[32px] rounded-[50%] bg-amber-200/40 blur-md" />
    </div>
  );
}

function Screen() {
  return (
    <div className="relative flex h-full rounded-[14px] overflow-hidden bg-[#f4f6f8]">
      <div className="w-[92px] shrink-0 bg-[#0d2a30] px-2 py-2.5 text-white/70">
        <div className="flex items-center gap-1.5 px-1 pb-2.5">
          <span className="w-4 h-4 rounded-[5px] bg-gradient-to-br from-emerald-400 to-teal-500 text-white text-[8px] font-extrabold flex items-center justify-center">C</span>
          <span className="text-[8.5px] font-bold text-white whitespace-nowrap">Cashly <span className="text-emerald-300">POS</span></span>
        </div>
        <div className="space-y-1">
          {MENU.map(({ icon: Icon, label }, i) => (
            <div key={label} className={`flex items-center gap-1.5 px-1.5 py-[5px] rounded-md text-[7.5px] ${i === 0 ? 'bg-emerald-500 text-white font-semibold shadow-sm' : ''}`}>
              <Icon className="w-2.5 h-2.5" /> {label}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 min-w-0 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] font-bold text-slate-800 leading-none">Dashboard</p>
            <p className="mt-0.5 text-[6px] text-slate-400">Today's business at a glance</p>
          </div>
          <div className="flex items-center gap-1.5 text-slate-400">
            <Search className="w-2.5 h-2.5" />
            <Bell className="w-2.5 h-2.5" />
            <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-amber-300 to-orange-400" />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {STATS.map(({ icon: Icon, label, value, change, tone, chip }) => (
            <div key={label} className={`rounded-lg p-1.5 ${tone}`}>
              <div className="flex items-center gap-1">
                <span className={`w-3.5 h-3.5 rounded-[4px] ${chip} text-white flex items-center justify-center`}><Icon className="w-2 h-2" /></span>
                <span className="text-[6px] font-semibold text-slate-500">{label}</span>
              </div>
              <p className="mt-1 text-[12px] font-extrabold text-slate-900 tracking-tight leading-none">{value}</p>
              <p className="mt-0.5 text-[5.5px] font-semibold text-emerald-600">{change} this week</p>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-white border border-slate-200/80 p-2">
          <div className="flex items-center justify-between">
            <p className="text-[8px] font-bold text-slate-800">Sales overview</p>
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[5.5px] font-semibold text-slate-500">This week</span>
          </div>
          <div className="mt-1 flex gap-1">
            <div className="h-[112px] py-0.5 flex flex-col justify-between text-[5px] text-slate-400"><span>15k</span><span>10k</span><span>5k</span><span>0</span></div>
            <div className="relative flex-1 h-[112px]">
              <svg viewBox="0 0 240 100" className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="posSceneFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[4, 35, 66, 97].map(y => (
                  <line key={y} x1="0" x2="240" y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                ))}
                <path d={`${SALES_LINE} L240 100 L0 100 Z`} fill="url(#posSceneFill)" />
                <path d={SALES_LINE} fill="none" stroke="#10b981" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="absolute left-[83.3%] top-[38%] w-2 h-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white border-2 border-emerald-500" />
              <span className="absolute left-[83.3%] top-[38%] -translate-x-1/2 -translate-y-[calc(100%+7px)] px-1.5 py-0.5 rounded bg-emerald-600 text-white text-[6px] font-bold whitespace-nowrap shadow">Rs 12,840</span>
            </div>
          </div>
          <div className="mt-1 pl-4 flex justify-between text-[5px] text-slate-400">
            {DAYS.map(d => <span key={d}>{d}</span>)}
          </div>
        </div>
      </div>

      {/* Glare on the glass. */}
      <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(118deg,rgba(255,255,255,0.22)_0%,rgba(255,255,255,0.04)_34%,transparent_35%)]" />
    </div>
  );
}

/** The picture at whatever width its box has (its height follows, 7:6). */
export function ScaledPosScene({ className = '' }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / SCENE_WIDTH));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} aria-hidden className={`relative aspect-[7/6] ${className}`}>
      {scale > 0 && (
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `scale(${scale})` }}>
          <PosScene />
        </div>
      )}
    </div>
  );
}

export function PosScene() {
  return (
    <div className="relative w-[560px] h-[480px]">
      {/* The café behind: warm light, lamps and out-of-focus highlights. */}
      <div className="absolute left-[150px] -top-[20px] w-[420px] h-[320px] rounded-full bg-amber-200/10 blur-3xl" />
      <Lamp className="left-[120px] -top-[150px]" size={0.6} blur="3px" />
      <Lamp className="left-[300px] -top-[80px]" size={1} blur="1.5px" />
      <Lamp className="left-[470px] -top-[120px]" size={0.75} blur="2.5px" />
      {[
        'left-[40px] top-[40px] w-7 h-7 bg-amber-200/25',
        'left-[548px] top-[150px] w-5 h-5 bg-white/15',
        'left-[90px] top-[210px] w-4 h-4 bg-emerald-200/20',
        'left-[20px] top-[120px] w-10 h-10 bg-amber-100/10',
        'left-[540px] top-[300px] w-8 h-8 bg-amber-200/15'
      ].map(c => <span key={c} className={`absolute rounded-full blur-[3px] ${c}`} />)}

      {/* The counter, and the shadows the hardware casts on it. */}
      <div className="absolute -left-12 -right-12 top-[392px] h-[120px] rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(148,163,184,0.22),transparent_70%)]" />
      <div className="absolute left-[180px] top-[428px] w-[340px] h-[44px] rounded-[50%] bg-black/60 blur-xl" />
      <div className="absolute left-[24px] top-[452px] w-[230px] h-[36px] rounded-[50%] bg-black/70 blur-lg" />

      {/* The stand: its neck, and the base unit it sits on. */}
      <div className="absolute left-[318px] top-[270px] w-[92px] h-[100px] bg-gradient-to-r from-[#1b2027] via-[#363d47] to-[#12161b] [clip-path:polygon(16%_0,84%_0,100%_100%,0_100%)]" />
      <div className="absolute left-[200px] top-[350px] w-[300px] h-[100px]">
        <div className="h-[28px] bg-gradient-to-b from-[#454c57] to-[#272c34] [clip-path:polygon(5%_0,100%_0,95%_100%,0_100%)]" />
        <div className="h-[72px] w-[95%] rounded-b-[12px] bg-gradient-to-b from-[#1a1e24] to-[#07090c] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
          <div className="ml-auto mr-[14%] w-[40%] pt-[34px]"><div className="h-[3px] rounded-full bg-black/60 shadow-[0_1px_0_rgba(255,255,255,0.06)]" /></div>
        </div>
        <div className="absolute right-0 top-0 w-[15px] h-[100px] bg-gradient-to-b from-[#1c2026] to-[#050608] [clip-path:polygon(0_28px,100%_0,100%_72px,0_100px)]" />
      </div>

      {/* The touchscreen, leaning back on its stand. */}
      <div className="absolute left-[110px] top-[18px] w-[440px] h-[300px] [transform:perspective(1200px)_rotateY(-12deg)_rotateX(7deg)_rotateZ(-2deg)]">
        <div className="relative h-full rounded-[26px] p-[11px] bg-gradient-to-br from-[#2e343d] via-[#0f1318] to-[#05070a] ring-1 ring-white/10 shadow-[7px_9px_0_0_#030405,0_40px_60px_-12px_rgba(0,0,0,0.75)]">
          <Screen />
          <span className="absolute bottom-[3px] left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white/25" />
        </div>
      </div>

      {/* The receipt printer in front — a thermal till printer, with the receipt curling out. */}
      <div className="absolute left-[36px] top-[292px] w-[196px] h-[180px]">
        {/* The receipt, torn off and curling up out of the slot (behind the printer). */}
        <div className="absolute left-[48px] -top-[26px] w-[100px] origin-bottom [transform:perspective(500px)_rotateX(-13deg)]">
          <div className="bg-gradient-to-b from-white via-white to-slate-200 shadow-[0_3px_8px_rgba(0,0,0,0.4)] [clip-path:polygon(0_6px,7%_0,14%_6px,21%_0,28%_6px,35%_0,42%_6px,50%_0,58%_6px,65%_0,72%_6px,79%_0,86%_6px,93%_0,100%_6px,100%_100%,0_100%)] px-2.5 pt-3.5 pb-2 space-y-[5px]">
            <div className="h-[3px] w-1/2 mx-auto rounded-full bg-slate-400" />
            <div className="h-[2px] w-full rounded-full bg-slate-200" />
            <div className="h-[2px] w-5/6 rounded-full bg-slate-200" />
            <div className="h-[2px] w-full rounded-full bg-slate-200" />
            <div className="flex justify-between items-center pt-0.5">
              <span className="h-[3px] w-7 rounded-full bg-slate-500" />
              <span className="h-[3px] w-10 rounded-full bg-slate-700" />
            </div>
            <div className="flex items-end justify-center gap-[2px] pt-1">
              {[3, 1, 2, 1, 3, 1, 1, 2, 3, 1, 2, 1, 3, 2, 1].map((w, i) => (
                <span key={i} style={{ width: w }} className="h-2.5 rounded-[0.5px] bg-slate-800/90" />
              ))}
            </div>
          </div>
        </div>

        {/* The lid, over the paper roll. */}
        <div className="absolute inset-x-0 top-[36px] h-[52px] rounded-t-[62px] rounded-b-[3px] bg-gradient-to-b from-[#6d7681] via-[#3c444e] to-[#282e36] ring-1 ring-white/10 shadow-[inset_0_2px_1px_rgba(255,255,255,0.24)]" />
        {/* The paper slot, at the front edge of the lid. */}
        <div className="absolute left-[26px] right-[26px] top-[62px] h-[6px] rounded-full bg-[#04060a] shadow-[0_1px_0_rgba(255,255,255,0.16),inset_0_1px_2px_rgba(0,0,0,0.9)]" />
        {/* The front face, with the controls. */}
        <div className="absolute inset-x-[2px] top-[88px] bottom-0 rounded-t-[2px] rounded-b-[16px] bg-gradient-to-b from-[#23282f] to-[#090b0e] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]">
          {/* Ready (green) and power (amber) LEDs, and the feed button. */}
          <div className="absolute right-[15px] top-[13px] flex items-center gap-[7px]">
            <span className="w-[6px] h-[6px] rounded-full bg-emerald-400 shadow-[0_0_8px_2px_rgba(52,211,153,0.55)]" />
            <span className="w-[6px] h-[6px] rounded-full bg-amber-400/55" />
            <span className="ml-[3px] w-[24px] h-[9px] rounded-full bg-white/[0.08] ring-1 ring-white/10" />
          </div>
          {/* A quiet brand bar, and the seam of the paper tray below. */}
          <span className="absolute left-[15px] top-[15px] h-[5px] w-[32px] rounded-full bg-white/10" />
          <span className="absolute left-[16px] right-[16px] bottom-[18px] h-[3px] rounded-full bg-black/50 shadow-[0_1px_0_rgba(255,255,255,0.05)]" />
        </div>
        {/* The right side, for depth. */}
        <div className="absolute -right-[11px] top-[46px] w-[13px] h-[134px] bg-gradient-to-b from-[#1a1e24] to-[#040506] [clip-path:polygon(0_12px,100%_0,100%_90%,0_100%)]" />
      </div>
    </div>
  );
}
