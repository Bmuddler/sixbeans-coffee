import { clsx } from 'clsx';

type BadgeVariant = 'pending' | 'approved' | 'denied' | 'info';

interface BadgeProps {
  variant: BadgeVariant;
  children: React.ReactNode;
  className?: string;
}

const variantStyles: Record<BadgeVariant, string> = {
  pending: 'bg-warning-50 text-warning-700 ring-warning-500/20',
  approved: 'bg-success-50 text-success-700 ring-success-500/20',
  denied: 'bg-danger-50 text-danger-700 ring-danger-500/20',
  info: 'bg-info-50 text-info-700 ring-info-500/20',
};

export function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
