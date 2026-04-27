import { useState, useEffect } from 'react';
import {
  MapPin,
  Clock,
  Phone,
  ArrowRight,
  Send,
  Briefcase,
  Star,
  Coffee,
  Heart,
  Menu,
  X,
  Smartphone,
} from 'lucide-react';
import { applications, api } from '@/lib/api';
import toast from 'react-hot-toast';
import type { LocationPublic } from '@/types';

const POSITIONS = [
  { title: 'Barista', desc: 'Craft amazing drinks, connect with customers, and be part of the Six Beans family.' },
  { title: 'Baker', desc: 'Create fresh pastries and baked goods that pair perfectly with our coffee.' },
  { title: 'Shift Lead', desc: 'Lead the team, manage operations, and keep the good vibes flowing.' },
];


export function LandingPage() {
  const [mobileNav, setMobileNav] = useState(false);
  const [appForm, setAppForm] = useState({ name: '', email: '', phone: '', position: 'Barista', location: 'Apple Valley', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [locations, setLocations] = useState<LocationPublic[]>([]);

  useEffect(() => {
    api.get('/locations/homepage').then((r) => setLocations(r.data as LocationPublic[])).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-white">
      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="#">
              <img src="/logo.png" alt="Six Beans Coffee Co." className="h-12 w-auto rounded-lg"  />
            </a>
            <div className="hidden md:flex items-center gap-8">
              <a href="#order" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Order Ahead</a>
              <a href="#about" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">About</a>
              <a href="#locations" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Locations</a>
              <a href="#careers" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Careers</a>
            </div>
            <button onClick={() => setMobileNav(!mobileNav)} className="md:hidden p-2 text-gray-600">
              {mobileNav ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {mobileNav && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
            <a href="#order" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">Order Ahead</a>
            <a href="#about" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">About</a>
            <a href="#locations" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">Locations</a>
            <a href="#careers" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">Careers</a>
          </div>
        )}
      </nav>

      {/* HERO */}
      <section className="relative pt-16 overflow-hidden" style={{ background: 'linear-gradient(135deg, #4A3428 0%, #3A2820 40%, #2A1E18 100%)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #5CB832 0%, transparent 50%), radial-gradient(circle at 80% 20%, #C4B99A 0%, transparent 40%)' }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-36">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 text-sm font-medium" style={{ backgroundColor: 'rgba(92, 184, 50, 0.15)', color: '#5CB832' }}>
                <Coffee className="h-4 w-4" />
                6 Locations in the High Desert
              </div>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black text-white leading-[1.05] tracking-tight">
                Extraordinarily
                <br />
                <span style={{ color: '#5CB832' }}>Good Coffee.</span>
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-gray-300 max-w-xl leading-relaxed">
                Incredibly good coffee and specialty drinks served through our convenient drive-thru, cozy cafes, and walk-up windows.
              </p>
              <div className="mt-10 flex flex-wrap gap-4">
                <a href="#order" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-bold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-green-500/25" style={{ backgroundColor: '#5CB832' }}>
                  Order Ahead <ArrowRight className="h-5 w-5" />
                </a>
                <a href="#locations" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-bold border-2 border-white/30 text-white hover:bg-white/10 transition-all">
                  Find a Location <MapPin className="h-5 w-5" />
                </a>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="relative">
                <img src="/hero1.jpg" alt="Espresso shots at Six Beans" className="rounded-3xl shadow-2xl w-full max-w-md ml-auto object-cover aspect-[4/5]" />
                <img src="/latte1.jpg" alt="Six Beans latte" className="absolute -bottom-8 -left-8 w-48 h-48 rounded-2xl shadow-xl object-cover border-4 border-white" />
              </div>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" className="w-full"><path d="M0 80L60 73.3C120 66.7 240 53.3 360 48.3C480 43.3 600 46.7 720 51.7C840 56.7 960 63.3 1080 63.3C1200 63.3 1320 56.7 1380 53.3L1440 50V80H0Z" fill="white" /></svg>
        </div>
      </section>

      {/* ORDER AHEAD */}
      <section id="order" className="py-20 sm:py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #5CB832 0%, #4AA028 100%)' }}>
            <div className="grid lg:grid-cols-2 gap-8 items-center p-8 sm:p-12 lg:p-16">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-5 text-sm font-semibold bg-white/20 text-white">
                  <Star className="h-4 w-4" /> Rewards & Order Ahead
                </div>
                <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white tracking-tight leading-tight">
                  Skip the Line.<br />Order on the App.
                </h2>
                <p className="mt-5 text-lg text-white/85 leading-relaxed max-w-md">
                  Download the <strong>Six Beans Coffee Co Rewards</strong> app to order ahead, earn points on every purchase, and get exclusive rewards.
                </p>
                <div className="mt-4 space-y-2 text-white/80 text-sm">
                  <p className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-white" /> Order ahead from any location</p>
                  <p className="flex items-center gap-2"><Star className="h-4 w-4 text-white" /> Earn points on every purchase</p>
                  <p className="flex items-center gap-2"><Heart className="h-4 w-4 text-white" /> Exclusive rewards and freebies</p>
                </div>
                <div className="mt-8 flex flex-wrap gap-4">
                  <a href="https://apps.apple.com/us/app/six-beans-coffee-co-rewards/id1357121183" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-black text-white font-semibold hover:bg-gray-900 transition-colors shadow-lg">
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                    <div className="text-left"><div className="text-[10px] leading-none opacity-80">Download on the</div><div className="text-base leading-tight">App Store</div></div>
                  </a>
                  <a href="https://play.google.com/store/apps/details?id=com.tapmango.sixbeanscoffee" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-black text-white font-semibold hover:bg-gray-900 transition-colors shadow-lg">
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="currentColor"><path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.302 2.302a1 1 0 010 1.38l-2.302 2.302L15.396 13l2.302-2.492zM5.864 2.658L16.8 8.99l-2.302 2.303-8.634-8.635z"/></svg>
                    <div className="text-left"><div className="text-[10px] leading-none opacity-80">Get it on</div><div className="text-base leading-tight">Google Play</div></div>
                  </a>
                </div>
              </div>
              <div className="hidden lg:flex items-center justify-center">
                <div className="relative">
                  <div className="w-72 rounded-[2.5rem] border-[6px] border-white/20 bg-white shadow-2xl overflow-hidden">
                    <div className="px-6 pt-8 pb-4 text-center" style={{ backgroundColor: '#4A3428' }}>
                      <img src="/logo.png" alt="Six Beans" className="h-14 w-auto mx-auto mb-3" />
                      <p className="text-white text-sm font-bold">Order Ahead</p>
                      <p className="text-white/60 text-xs">Skip the line, earn rewards</p>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="rounded-xl p-3 flex items-center gap-3 border border-gray-100 hover:shadow-sm transition-shadow">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}><Coffee className="h-5 w-5" style={{ color: '#5CB832' }} /></div>
                        <div className="flex-1"><p className="text-sm font-bold" style={{ color: '#4A3428' }}>Iced Caramel Latte</p><p className="text-[11px] text-gray-400">Grande · Extra shot</p></div>
                        <p className="text-sm font-bold" style={{ color: '#5CB832' }}>$6.50</p>
                      </div>
                      <div className="rounded-xl p-3 flex items-center gap-3 border border-gray-100 hover:shadow-sm transition-shadow">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}><Coffee className="h-5 w-5" style={{ color: '#5CB832' }} /></div>
                        <div className="flex-1"><p className="text-sm font-bold" style={{ color: '#4A3428' }}>Mocha Frappe</p><p className="text-[11px] text-gray-400">Grande · Whip cream</p></div>
                        <p className="text-sm font-bold" style={{ color: '#5CB832' }}>$7.25</p>
                      </div>
                      <div className="rounded-xl p-3 flex items-center gap-3 border border-gray-100 hover:shadow-sm transition-shadow">
                        <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#F5F0E8' }}><Coffee className="h-5 w-5" style={{ color: '#5CB832' }} /></div>
                        <div className="flex-1"><p className="text-sm font-bold" style={{ color: '#4A3428' }}>Cold Brew</p><p className="text-[11px] text-gray-400">Large · Vanilla sweet cream</p></div>
                        <p className="text-sm font-bold" style={{ color: '#5CB832' }}>$5.75</p>
                      </div>
                      <button className="w-full rounded-full py-2.5 text-sm font-bold text-white" style={{ backgroundColor: '#5CB832' }}>
                        Add to Order
                      </button>
                    </div>
                    <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
                      <div className="flex items-center gap-1.5"><Star className="h-4 w-4 text-yellow-500" /><span className="text-xs font-bold" style={{ color: '#4A3428' }}>125 pts</span></div>
                      <span className="text-[10px] text-gray-400">Free drink at 200!</span>
                    </div>
                  </div>
                  <div className="absolute -top-3 -right-4 bg-white rounded-2xl shadow-xl p-2.5 animate-bounce">
                    <div className="flex items-center gap-1.5">
                      <Star className="h-4 w-4 text-yellow-500" />
                      <span className="text-xs font-bold" style={{ color: '#4A3428' }}>+25 pts</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="grid grid-cols-2 gap-4">
              <img src="/hero2.jpg" alt="Six Beans branded cup" className="rounded-2xl shadow-lg object-cover aspect-[3/4] w-full" />
              <img src="/espresso1.jpg" alt="Espresso pour" className="rounded-2xl shadow-lg object-cover aspect-[3/4] w-full mt-8" />
            </div>
            <div>
              <h2 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ color: '#4A3428' }}>
                More Than Just Coffee
              </h2>
              <p className="mt-6 text-lg text-gray-600 leading-relaxed">
                Six Beans started with two friends who've known each other since birth. We come from construction, and we wanted to build something different — a business that creates an amazing product while keeping our families and community at the heart of everything we do.
              </p>
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-6">
                {[
                  { icon: <Coffee className="h-6 w-6" />, title: 'Handcrafted', desc: 'Every drink made to order' },
                  { icon: <Heart className="h-6 w-6" />, title: 'Community', desc: 'Your neighbors, your coffee' },
                  { icon: <Star className="h-6 w-6" />, title: 'Drive-Thru', desc: 'Grab and go, or stay a while' },
                ].map((item) => (
                  <div key={item.title} className="text-center">
                    <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-3" style={{ backgroundColor: 'rgba(92, 184, 50, 0.1)', color: '#5CB832' }}>{item.icon}</div>
                    <h3 className="font-bold text-gray-900 text-sm">{item.title}</h3>
                    <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL FEED */}
      <section className="py-16" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-3xl font-black mb-2" style={{ color: '#4A3428' }}>Follow the Vibes</h3>
          <p className="text-gray-500 mb-6">See what's brewing on our socials</p>
          <div className="flex items-center justify-center gap-6 mb-8 flex-wrap">
            <a href="https://www.instagram.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white shadow-sm border border-gray-200 text-sm font-semibold hover:shadow-md transition-all" style={{ color: '#4A3428' }}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#E1306C' }}><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              @sixbeanscoffee
            </a>
            <a href="https://www.facebook.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white shadow-sm border border-gray-200 text-sm font-semibold hover:shadow-md transition-all" style={{ color: '#4A3428' }}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="#1877F2"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              Six Beans Coffee Co.
            </a>
            <a href="https://www.tiktok.com/@six.beans.coffee" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white shadow-sm border border-gray-200 text-sm font-semibold hover:shadow-md transition-all" style={{ color: '#4A3428' }}>
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
              @six.beans.coffee
            </a>
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { src: '/hero1.jpg', alt: 'Espresso shots' },
              { src: '/drink1.jpg', alt: 'Six Beans drinks' },
              { src: '/hero2.jpg', alt: 'Branded cup' },
              { src: '/drink2.jpg', alt: 'Coffee pour' },
              { src: '/espresso1.jpg', alt: 'Espresso close-up' },
              { src: '/drink3.jpg', alt: 'Iced coffee' },
              { src: '/latte1.jpg', alt: 'Latte art' },
              { src: '/drink4.jpg', alt: 'Coffee vibes' },
            ].map((photo, i) => (
              <a key={i} href="https://www.instagram.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="aspect-square rounded-xl overflow-hidden group shadow-sm">
                <img src={photo.src} alt={photo.alt} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
              </a>
            ))}
          </div>

          <a href="https://www.instagram.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-2 px-8 py-3 rounded-full text-white font-bold transition-all hover:scale-105" style={{ backgroundColor: '#5CB832' }}>
            See More on Instagram <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </section>

      {/* LOCATIONS */}
      <section id="locations" className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ color: '#4A3428' }}>Our Locations</h2>
            <p className="mt-4 text-lg text-gray-500">6 shops across the High Desert — there's one near you</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {locations.map((loc) => {
              const cityLine = `${loc.city}, ${loc.state} ${loc.zip_code}`;
              const mapQuery = encodeURIComponent(`${loc.address} ${cityLine}`);
              return (
                <div key={loc.id} className="rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl transition-all group">
                  <div className="h-3" style={{ backgroundColor: '#5CB832' }} />
                  <div className="p-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-3">{loc.display_name}</h3>
                    <div className="space-y-2.5 text-sm text-gray-600">
                      <div className="flex items-start gap-2.5"><MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: '#5CB832' }} /><div><p>{loc.address}</p><p>{cityLine}</p></div></div>
                      {loc.phone && <div className="flex items-center gap-2.5"><Phone className="h-4 w-4 flex-shrink-0" style={{ color: '#5CB832' }} /><a href={`tel:${loc.phone.replace(/[^0-9]/g, '')}`} className="hover:underline">{loc.phone}</a></div>}
                      {loc.hours && <div className="flex items-center gap-2.5"><Clock className="h-4 w-4 flex-shrink-0" style={{ color: '#5CB832' }} /><span>{loc.hours}</span></div>}
                    </div>
                    <a href={`https://maps.google.com/?q=${mapQuery}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors" style={{ color: '#5CB832' }}>
                      Get Directions <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CAREERS */}
      <section id="careers" className="py-20 sm:py-28" style={{ background: 'linear-gradient(135deg, #4A3428 0%, #3A2820 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6 text-sm font-medium" style={{ backgroundColor: 'rgba(92, 184, 50, 0.15)', color: '#5CB832' }}>
                <Briefcase className="h-4 w-4" /> Now Hiring
              </div>
              <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
                Join the<br /><span style={{ color: '#5CB832' }}>Six Beans Family</span>
              </h2>
              <p className="mt-6 text-lg text-gray-300 leading-relaxed">
                We're always looking for amazing people to join our team. Great pay, flexible schedules, and all the coffee you can drink.
              </p>
              <div className="mt-8 space-y-4">
                {POSITIONS.map((pos) => (
                  <div key={pos.title} className="rounded-xl p-5 border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                    <h4 className="text-lg font-bold text-white">{pos.title}</h4>
                    <p className="text-sm text-gray-400 mt-1">{pos.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-8 shadow-2xl">
              <h3 className="text-2xl font-bold mb-6" style={{ color: '#4A3428' }}>Apply Now</h3>
              <div className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label><input type="text" value={appForm.name} onChange={(e) => setAppForm({ ...appForm, name: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none focus:ring-green-500 focus:border-green-500" placeholder="Your full name" /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Email *</label><input type="email" value={appForm.email} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none focus:ring-green-500 focus:border-green-500" placeholder="email@example.com" /></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label><input type="tel" value={appForm.phone} onChange={(e) => setAppForm({ ...appForm, phone: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none focus:ring-green-500 focus:border-green-500" placeholder="(760) 555-0000" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Position</label><select value={appForm.position} onChange={(e) => setAppForm({ ...appForm, position: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm"><option>Barista</option><option>Baker</option><option>Shift Lead</option><option>Delivery Driver</option></select></div>
                  <div><label className="block text-sm font-medium text-gray-700 mb-1">Location</label><select value={appForm.location} onChange={(e) => setAppForm({ ...appForm, location: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm">{locations.map((l) => <option key={l.id}>{l.display_name}</option>)}</select></div>
                </div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Tell us about yourself</label><textarea value={appForm.message} onChange={(e) => setAppForm({ ...appForm, message: e.target.value })} rows={3} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none focus:ring-green-500 focus:border-green-500" placeholder="Experience, availability, anything you'd like us to know..." /></div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={async () => {
                    if (!appForm.name || !appForm.email || !appForm.phone) {
                      toast.error('Please fill in all required fields.');
                      return;
                    }
                    setSubmitting(true);
                    try {
                      await applications.submit(appForm);
                      toast.success("Application submitted! We'll be in touch.");
                      setAppForm({ name: '', email: '', phone: '', position: 'Barista', location: 'Apple Valley', message: '' });
                    } catch {
                      toast.error('Failed to submit application. Please try again.');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-base font-bold text-white transition-all hover:scale-[1.02] hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#5CB832' }}
                >
                  {submitting ? 'Submitting...' : 'Submit Application'} <Send className="h-4 w-4" />
                </button>
                <p className="text-xs text-gray-400 text-center">We'll reach out within 48 hours!</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="py-12" style={{ backgroundColor: '#4A3428' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            <div>
              <img src="/logo.png" alt="Six Beans Coffee Co." className="h-14 w-auto rounded-lg mb-4" />
              <p className="text-sm text-gray-400 leading-relaxed">Extraordinarily good coffee served across 6 locations in California's High Desert.</p>
              <div className="flex gap-3 mt-6">
                <a href="https://www.instagram.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
                </a>
                <a href="https://www.facebook.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
                <a href="https://www.tiktok.com/@six.beans.coffee" target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>
                </a>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">Quick Links</h4>
              <div className="space-y-2.5">
                <a href="#order" className="block text-sm text-gray-400 hover:text-white transition-colors">Order Ahead</a>
                <a href="#about" className="block text-sm text-gray-400 hover:text-white transition-colors">About Us</a>
                <a href="#locations" className="block text-sm text-gray-400 hover:text-white transition-colors">Locations</a>
                <a href="#careers" className="block text-sm text-gray-400 hover:text-white transition-colors">Careers</a>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">Connect</h4>
              <div className="space-y-2.5 text-sm text-gray-400">
                <a href="https://www.instagram.com/sixbeanscoffee/" className="block hover:text-white transition-colors">Instagram @sixbeanscoffee</a>
                <a href="https://www.facebook.com/sixbeanscoffee/" className="block hover:text-white transition-colors">Facebook — Six Beans Coffee Co.</a>
                <a href="https://www.tiktok.com/@six.beans.coffee" className="block hover:text-white transition-colors">TikTok @six.beans.coffee</a>
                <a href="https://sixbeanscoffee.com" className="block hover:text-white transition-colors">sixbeanscoffee.com</a>
              </div>
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-white/10 text-center">
            <p className="text-sm text-gray-500">&copy; {new Date().getFullYear()} Six Beans Coffee Co. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
