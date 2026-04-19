import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MapPin,
  Clock,
  Phone,
  Instagram,
  Facebook,
  ArrowRight,
  ChevronDown,
  Send,
  Briefcase,
  Star,
  Coffee,
  Heart,
  Menu,
  X,
} from 'lucide-react';

const LOCATIONS = [
  { name: 'Apple Valley', address: '21788 Bear Valley Rd', city: 'Apple Valley, CA 92308', phone: '(760) 946-9008', hours: 'Mon-Sat 5:30am-7pm · Sun 6am-7pm', mapQuery: '21788+Bear+Valley+Rd+Apple+Valley+CA' },
  { name: 'Hesperia', address: '15760 Ranchero Rd', city: 'Hesperia, CA 92345', phone: '(760) 948-0164', hours: 'Mon-Sat 5:30am-7pm · Sun 6am-7pm', mapQuery: '15760+Ranchero+Rd+Hesperia+CA' },
  { name: 'Barstow', address: '921 Barstow Rd', city: 'Barstow, CA 92311', phone: '(760) 229-0997', hours: 'Mon-Sat 5:30am-7pm · Sun 6am-7pm', mapQuery: '921+Barstow+Rd+Barstow+CA' },
  { name: 'Victorville', address: '12875 Bear Valley Rd', city: 'Victorville, CA 92392', phone: '(760) 983-5028', hours: 'Mon-Sat 5:30am-7pm · Sun 6am-7pm', mapQuery: '12875+Bear+Valley+Rd+Victorville+CA' },
  { name: 'Yucca Loma', address: '13730 Apple Valley Rd', city: 'Apple Valley, CA 92307', phone: '(442) 292-2185', hours: 'Mon-Sat 5:30am-7pm · Sun 6am-7pm', mapQuery: '13730+Apple+Valley+Rd+Apple+Valley+CA' },
  { name: '7th Street', address: '14213 7th St', city: 'Victorville, CA 92395', phone: '(442) 229-2222', hours: 'Mon-Sun 6am-7pm', mapQuery: '14213+7th+St+Victorville+CA' },
];

const POSITIONS = [
  { title: 'Barista', desc: 'Craft amazing drinks, connect with customers, and be part of the Six Beans family.' },
  { title: 'Baker', desc: 'Create fresh pastries and baked goods that pair perfectly with our coffee.' },
  { title: 'Shift Lead', desc: 'Lead the team, manage operations, and keep the good vibes flowing.' },
];

export function LandingPage() {
  const [mobileNav, setMobileNav] = useState(false);
  const [appForm, setAppForm] = useState({ name: '', email: '', phone: '', position: 'Barista', location: 'Apple Valley', message: '' });

  return (
    <div className="min-h-screen bg-white">
      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <a href="#" className="flex items-center gap-2">
              <img src="/logo.png" alt="Six Beans Coffee Co." className="h-12 w-auto" />
            </a>
            <div className="hidden md:flex items-center gap-8">
              <a href="#about" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">About</a>
              <a href="#locations" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Locations</a>
              <a href="#careers" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">Careers</a>
              <Link to="/login" className="text-sm font-medium px-5 py-2 rounded-full text-white transition-all hover:scale-105" style={{ backgroundColor: '#5CB832' }}>
                Employee Portal
              </Link>
            </div>
            <button onClick={() => setMobileNav(!mobileNav)} className="md:hidden p-2 text-gray-600">
              {mobileNav ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
        {mobileNav && (
          <div className="md:hidden border-t border-gray-100 bg-white px-4 py-4 space-y-3">
            <a href="#about" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">About</a>
            <a href="#locations" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">Locations</a>
            <a href="#careers" onClick={() => setMobileNav(false)} className="block text-sm font-medium text-gray-600">Careers</a>
            <Link to="/login" className="block text-sm font-medium text-center px-5 py-2 rounded-full text-white" style={{ backgroundColor: '#5CB832' }}>Employee Portal</Link>
          </div>
        )}
      </nav>

      {/* HERO */}
      <section className="relative pt-16 overflow-hidden" style={{ background: 'linear-gradient(135deg, #4A3428 0%, #3A2820 40%, #2A1E18 100%)' }}>
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, #5CB832 0%, transparent 50%), radial-gradient(circle at 80% 20%, #C4B99A 0%, transparent 40%)' }} />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 sm:py-32 lg:py-40">
          <div className="max-w-3xl">
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
              Incredibly good coffee and specialty drinks served through our convenient drive-thru, cozy cafes, and walk-up windows. Handcrafted with love in every cup.
            </p>
            <div className="mt-10 flex flex-wrap gap-4">
              <a href="#locations" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-bold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-green-500/25" style={{ backgroundColor: '#5CB832' }}>
                Find a Location <ArrowRight className="h-5 w-5" />
              </a>
              <a href="#careers" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-base font-bold border-2 border-white/30 text-white hover:bg-white/10 transition-all">
                We're Hiring <Briefcase className="h-5 w-5" />
              </a>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
            <path d="M0 80L60 73.3C120 66.7 240 53.3 360 48.3C480 43.3 600 46.7 720 51.7C840 56.7 960 63.3 1080 63.3C1200 63.3 1320 56.7 1380 53.3L1440 50V80H0Z" fill="white" />
          </svg>
        </div>
      </section>

      {/* ABOUT */}
      <section id="about" className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ color: '#4A3428' }}>
              More Than Just Coffee
            </h2>
            <p className="mt-6 text-lg text-gray-600 leading-relaxed">
              Six Beans started with two friends who've known each other since birth. We come from construction, and we wanted to build something different — a business that creates an amazing product while keeping our families and community at the heart of everything we do.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: <Coffee className="h-8 w-8" />, title: 'Handcrafted Drinks', desc: 'Every beverage made to order by skilled baristas who care about quality.' },
              { icon: <Heart className="h-8 w-8" />, title: 'Community First', desc: 'We\'re not just a coffee shop — we\'re your neighbors building something great together.' },
              { icon: <Star className="h-8 w-8" />, title: 'Drive-Thru & Cafes', desc: 'Grab and go through our drive-thru or stay a while in our cozy cafes.' },
            ].map((item) => (
              <div key={item.title} className="text-center p-8 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-lg transition-all group">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl mb-5 transition-transform group-hover:scale-110" style={{ backgroundColor: 'rgba(92, 184, 50, 0.1)', color: '#5CB832' }}>
                  {item.icon}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INSTAGRAM BAND */}
      <section className="py-16" style={{ backgroundColor: '#F5F0E8' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h3 className="text-2xl font-bold mb-2" style={{ color: '#4A3428' }}>Follow Us on Instagram</h3>
          <a href="https://www.instagram.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-lg font-medium hover:underline" style={{ color: '#5CB832' }}>
            <Instagram className="h-5 w-5" /> @sixbeanscoffee
          </a>
          <p className="text-gray-500 mt-2 text-sm">Check out our latest drinks, behind-the-scenes, and High Desert vibes</p>
          <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {['Mocha Madness', 'Sunset Latte', 'Iced Matcha', 'Caramel Dream', 'Cold Brew', 'Seasonal Special'].map((name, i) => (
              <div key={name} className="aspect-square rounded-xl overflow-hidden relative group cursor-pointer" style={{ backgroundColor: i % 2 === 0 ? '#4A3428' : '#5CB832' }}>
                <div className="absolute inset-0 flex items-center justify-center text-white/80 group-hover:text-white transition-colors">
                  <div className="text-center">
                    <Coffee className="h-8 w-8 mx-auto mb-1 opacity-50 group-hover:opacity-80 transition-opacity" />
                    <span className="text-xs font-medium">{name}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LOCATIONS */}
      <section id="locations" className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl sm:text-5xl font-black tracking-tight" style={{ color: '#4A3428' }}>
              Our Locations
            </h2>
            <p className="mt-4 text-lg text-gray-500">6 shops across the High Desert — there's one near you</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {LOCATIONS.map((loc) => (
              <div key={loc.name} className="rounded-2xl border border-gray-200 overflow-hidden hover:shadow-xl transition-all group">
                <div className="h-3" style={{ backgroundColor: '#5CB832' }} />
                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-3">{loc.name}</h3>
                  <div className="space-y-2.5 text-sm text-gray-600">
                    <div className="flex items-start gap-2.5">
                      <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" style={{ color: '#5CB832' }} />
                      <div>
                        <p>{loc.address}</p>
                        <p>{loc.city}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Phone className="h-4 w-4 flex-shrink-0" style={{ color: '#5CB832' }} />
                      <a href={`tel:${loc.phone.replace(/[^0-9]/g, '')}`} className="hover:underline">{loc.phone}</a>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <Clock className="h-4 w-4 flex-shrink-0" style={{ color: '#5CB832' }} />
                      <span>{loc.hours}</span>
                    </div>
                  </div>
                  <a href={`https://maps.google.com/?q=${loc.mapQuery}`} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors" style={{ color: '#5CB832' }}>
                    Get Directions <ArrowRight className="h-4 w-4" />
                  </a>
                </div>
              </div>
            ))}
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
              <div className="mt-10 space-y-4">
                {POSITIONS.map((pos) => (
                  <div key={pos.title} className="rounded-xl p-5 border border-white/10 bg-white/5 hover:bg-white/10 transition-colors">
                    <h4 className="text-lg font-bold text-white">{pos.title}</h4>
                    <p className="text-sm text-gray-400 mt-1">{pos.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* APPLICATION FORM */}
            <div className="bg-white rounded-2xl p-8 shadow-2xl">
              <h3 className="text-2xl font-bold mb-6" style={{ color: '#4A3428' }}>Apply Now</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input type="text" value={appForm.name} onChange={(e) => setAppForm({ ...appForm, name: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none" style={{ '--tw-ring-color': '#5CB832' } as any} placeholder="Your full name" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                    <input type="email" value={appForm.email} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none" placeholder="email@example.com" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                    <input type="tel" value={appForm.phone} onChange={(e) => setAppForm({ ...appForm, phone: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none" placeholder="(760) 555-0000" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
                    <select value={appForm.position} onChange={(e) => setAppForm({ ...appForm, position: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none">
                      <option>Barista</option>
                      <option>Baker</option>
                      <option>Shift Lead</option>
                      <option>Delivery Driver</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Preferred Location</label>
                    <select value={appForm.location} onChange={(e) => setAppForm({ ...appForm, location: e.target.value })} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none">
                      {LOCATIONS.map((l) => <option key={l.name}>{l.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Tell us about yourself</label>
                  <textarea value={appForm.message} onChange={(e) => setAppForm({ ...appForm, message: e.target.value })} rows={3} className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:outline-none" placeholder="Any experience, availability, or anything you'd like us to know..." />
                </div>
                <button className="w-full flex items-center justify-center gap-2 rounded-full py-3 text-base font-bold text-white transition-all hover:scale-[1.02] hover:shadow-lg" style={{ backgroundColor: '#5CB832' }}>
                  Submit Application <Send className="h-4 w-4" />
                </button>
                <p className="text-xs text-gray-400 text-center">We'll reach out within 48 hours if you're a good fit!</p>
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
              <div className="mb-4">
                <img src="/logo.png" alt="Six Beans Coffee Co." className="h-14 w-auto brightness-0 invert" />
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">Extraordinarily good coffee served across 6 locations in California's High Desert.</p>
              <div className="flex gap-4 mt-6">
                <a href="https://www.instagram.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <Instagram className="h-5 w-5" />
                </a>
                <a href="https://www.facebook.com/sixbeanscoffee/" target="_blank" rel="noopener noreferrer" className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center text-white hover:bg-white/20 transition-colors">
                  <Facebook className="h-5 w-5" />
                </a>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">Quick Links</h4>
              <div className="space-y-2.5">
                <a href="#about" className="block text-sm text-gray-400 hover:text-white transition-colors">About Us</a>
                <a href="#locations" className="block text-sm text-gray-400 hover:text-white transition-colors">Locations</a>
                <a href="#careers" className="block text-sm text-gray-400 hover:text-white transition-colors">Careers</a>
                <Link to="/login" className="block text-sm text-gray-400 hover:text-white transition-colors">Employee Portal</Link>
                <Link to="/kiosk" className="block text-sm text-gray-400 hover:text-white transition-colors">Kiosk</Link>
              </div>
            </div>
            <div>
              <h4 className="text-white font-bold mb-4">Contact</h4>
              <div className="space-y-2.5 text-sm text-gray-400">
                <p>Apple Valley, Hesperia, Barstow,</p>
                <p>Victorville & surrounding areas</p>
                <a href="https://www.instagram.com/sixbeanscoffee/" className="block hover:text-white transition-colors">@sixbeanscoffee</a>
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
