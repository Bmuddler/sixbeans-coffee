import { Link } from 'react-router-dom';
import {
  Coffee,
  MapPin,
  Users,
  Clock,
  Calendar,
  DollarSign,
  Shield,
  Phone,
  Mail,
  Instagram,
  Facebook,
  ArrowRight,
  Heart,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

const LOCATIONS = [
  {
    name: 'Six Beans - Apple Valley',
    address: '21788 Bear Valley Rd, Apple Valley, CA 92308',
    phone: '(760) 946-9008',
    hours: 'Mon-Sun 5AM-7PM',
  },
  {
    name: 'Six Beans - Hesperia',
    address: '15760 Ranchero Rd, Hesperia, CA 92345',
    phone: '(760) 948-0164',
    hours: 'Mon-Sun 5AM-7PM',
  },
  {
    name: 'Six Beans - Barstow',
    address: '921 Barstow Rd, Barstow, CA 92311',
    phone: '(760) 229-0997',
    hours: 'Mon-Sun 5AM-7PM',
  },
  {
    name: 'Six Beans - Victorville',
    address: '12875 Bear Valley Rd, Victorville, CA 92392',
    phone: '(760) 983-5028',
    hours: 'Mon-Sun 5AM-7PM',
  },
  {
    name: 'Six Beans - Apple Valley (Yucca Loma)',
    address: '13730 Apple Valley Rd, Apple Valley, CA 92307',
    phone: '(442) 292-2185',
    hours: 'Mon-Sun 5AM-7PM',
  },
  {
    name: 'Six Beans - Victorville (7th St)',
    address: '14213 7th St, Victorville, CA 92395',
    phone: '(442) 229-2222',
    hours: 'Mon-Sun 6AM-7PM',
  },
];

const FEATURES = [
  {
    icon: <Clock className="h-8 w-8" />,
    title: 'Time Tracking',
    desc: 'Clock in/out with GPS verification. Track breaks and overtime automatically.',
  },
  {
    icon: <Calendar className="h-8 w-8" />,
    title: 'Smart Scheduling',
    desc: 'Create and manage schedules across all 6 locations with availability-aware tools.',
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: 'Team Management',
    desc: 'Shift swaps, coverage requests, and time-off management all in one place.',
  },
  {
    icon: <MapPin className="h-8 w-8" />,
    title: '6 Locations',
    desc: 'Manage all locations from a single dashboard with location-specific views.',
  },
  {
    icon: <DollarSign className="h-8 w-8" />,
    title: 'Payroll Ready',
    desc: 'AI-validated payroll generation with overtime calculations and CSV export.',
  },
  {
    icon: <Shield className="h-8 w-8" />,
    title: 'Role-Based Access',
    desc: 'Owners, managers, and employees each see exactly what they need.',
  },
];

export function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="absolute inset-x-0 top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-white">
            <Coffee className="h-8 w-8" />
            <span className="text-xl font-bold">Six Beans</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#about" className="text-sm text-white/80 hover:text-white transition-colors">
              About
            </a>
            <a href="#locations" className="text-sm text-white/80 hover:text-white transition-colors">
              Locations
            </a>
            <a href="#contact" className="text-sm text-white/80 hover:text-white transition-colors">
              Contact
            </a>
            <Link to="/login">
              <Button size="sm" variant="secondary">
                Employee Portal
              </Button>
            </Link>
          </nav>
          <Link to="/login" className="md:hidden">
            <Button size="sm" variant="secondary">
              Login
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #6F4E37 0%, #4A3428 50%, #2D5016 100%)',
        }}
      >
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(circle at 25% 25%, rgba(245, 230, 204, 0.3) 0%, transparent 50%), radial-gradient(circle at 75% 75%, rgba(245, 230, 204, 0.2) 0%, transparent 50%)',
            }}
          />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 pb-24 pt-32 sm:px-6 lg:px-8 text-center">
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: 'rgba(245, 230, 204, 0.2)' }}
          >
            <Coffee className="h-12 w-12" style={{ color: '#F5E6CC' }} />
          </div>
          <h1 className="text-4xl font-bold text-white sm:text-5xl lg:text-6xl tracking-tight">
            Six Beans Coffee Co.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed" style={{ color: '#F5E6CC' }}>
            Crafting exceptional coffee experiences across six neighborhood locations.
            Every bean carefully sourced, every cup thoughtfully prepared.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link to="/login">
              <Button
                size="lg"
                className="shadow-lg"
                style={{ backgroundColor: '#F5E6CC', color: '#6F4E37' }}
              >
                Employee Login
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            </Link>
            <Link to="/kiosk">
              <Button
                size="lg"
                variant="ghost"
                className="text-white border border-white/30 hover:bg-white/10"
              >
                Kiosk Mode
              </Button>
            </Link>
          </div>
        </div>

        {/* Wave divider */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" className="w-full">
            <path
              d="M0 40C240 80 480 0 720 40C960 80 1200 0 1440 40V80H0V40Z"
              fill="white"
            />
          </svg>
        </div>
      </section>

      {/* About */}
      <section id="about" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold" style={{ color: '#6F4E37' }}>
              More Than Just Coffee
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-gray-600">
              Founded with a passion for community and quality, Six Beans Coffee Co.
              has grown from a single neighborhood cafe into six beloved locations.
              We source our beans from sustainable farms around the world, roast
              them locally, and serve them with care. Our team of dedicated baristas
              brings warmth and expertise to every cup.
            </p>
            <div className="mt-10 grid grid-cols-3 gap-8">
              <div>
                <p className="text-3xl font-bold" style={{ color: '#6F4E37' }}>
                  6
                </p>
                <p className="mt-1 text-sm text-gray-500">Locations</p>
              </div>
              <div>
                <p className="text-3xl font-bold" style={{ color: '#2D5016' }}>
                  50+
                </p>
                <p className="mt-1 text-sm text-gray-500">Team Members</p>
              </div>
              <div>
                <p className="text-3xl font-bold" style={{ color: '#6F4E37' }}>
                  8
                </p>
                <p className="mt-1 text-sm text-gray-500">Years Brewing</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20" style={{ backgroundColor: '#FDFAF5' }}>
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-gray-900 mb-4">
            Everything Your Team Needs
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-2xl mx-auto">
            Our workforce management platform keeps all six locations running
            smoothly.
          </p>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="mb-4" style={{ color: '#6F4E37' }}>
                  {f.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2 text-sm text-gray-500">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Locations */}
      <section id="locations" className="py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-gray-900 mb-4">
            Our Locations
          </h2>
          <p className="text-center text-gray-500 mb-12 max-w-xl mx-auto">
            Find your nearest Six Beans and stop by for your favorite brew.
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {LOCATIONS.map((loc) => (
              <div
                key={loc.name}
                className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0"
                    style={{ backgroundColor: 'rgba(111, 78, 55, 0.1)' }}
                  >
                    <MapPin className="h-5 w-5" style={{ color: '#6F4E37' }} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{loc.name}</h3>
                    <p className="text-sm text-gray-500">{loc.address}</p>
                  </div>
                </div>
                <div className="space-y-1.5 text-sm text-gray-500">
                  <p className="flex items-center gap-2">
                    <Phone className="h-3.5 w-3.5 text-gray-400" />
                    {loc.phone}
                  </p>
                  <p className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-gray-400" />
                    {loc.hours}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section
        id="contact"
        className="py-20"
        style={{ backgroundColor: '#6F4E37' }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">Get In Touch</h2>
          <p className="text-lg mb-8" style={{ color: '#F5E6CC' }}>
            Questions, catering inquiries, or just want to say hello?
          </p>
          <div className="flex flex-wrap justify-center gap-8">
            <a
              href="mailto:hello@sixbeanscoffee.com"
              className="flex items-center gap-2 text-white hover:underline"
            >
              <Mail className="h-5 w-5" />
              hello@sixbeanscoffee.com
            </a>
            <a
              href="tel:5551000000"
              className="flex items-center gap-2 text-white hover:underline"
            >
              <Phone className="h-5 w-5" />
              (555) 100-0000
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white py-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2">
              <Coffee className="h-6 w-6" style={{ color: '#6F4E37' }} />
              <span className="text-lg font-bold" style={{ color: '#6F4E37' }}>
                Six Beans Coffee Co.
              </span>
            </div>
            <div className="flex items-center gap-6">
              <a
                href="#"
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a
                href="#"
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label="Facebook"
              >
                <Facebook className="h-5 w-5" />
              </a>
              <Link
                to="/login"
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Employee Portal
              </Link>
            </div>
          </div>
          <div className="mt-8 text-center">
            <p className="text-sm text-gray-400">
              &copy; {new Date().getFullYear()} Six Beans Coffee Co. All rights reserved.
              Made with <Heart className="inline h-3.5 w-3.5 text-red-400" /> and great coffee.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
