import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Trash2,
  Plus,
  Download,
  RefreshCw,
  BarChart3,
  Package,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'react-hot-toast';
import { usfoods } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

// ============================================================
// Types
// ============================================================

interface RunListItem {
  id: number;
  run_date: string;
  status: string;
  square_orders_count: number;
  total_line_items: number;
  created_at: string;
}

interface RunItem {
  id: number;
  run_id: number;
  shop_mapping_id: number;
  product_id: number;
  product_number: string | null;
  product_description: string | null;
  quantity: number;
  unit: string;
  square_item_name: string | null;
  is_flagged: boolean;
  flag_reason: string | null;
  is_filler: boolean;
  created_at: string | null;
}

interface ShopData {
  shop_name: string;
  customer_number: string;
  item_count: number;
  combined_count?: number;
  flagged_count: number;
  meets_minimum: boolean;
  is_alias?: boolean;
  items: RunItem[];
}

interface RunDetail {
  id: number;
  run_date: string;
  order_window_start: string | null;
  order_window_end: string | null;
  status: string;
  square_orders_count: number;
  total_line_items: number;
  created_at: string;
  updated_at: string | null;
  csv_data: string | null;
  shops: ShopData[];
}

interface Product {
  id: number;
  product_number: string;
  description: string;
  brand: string | null;
  pack_size: string | null;
  storage_class: string | null;
  default_unit: string;
  current_price: number | null;
}

interface Shop {
  id: number;
  location_id: number | null;
  customer_number: string;
  us_foods_account_name: string;
  distributor: string;
  department: string;
  is_routing_alias: boolean;
  notes: string | null;
}

interface PriceChange {
  product_number: string;
  description: string;
  current_price: number | null;
  previous_price: number | null;
  price_updated_at: string | null;
}

interface AnalyticsData {
  recent_runs: { id: number; run_date: string; status: string; total_line_items: number }[];
  price_changes: PriceChange[];
}

// ============================================================
// Constants
// ============================================================

const MINIMUM_ITEMS = 15;

const STATUS_LABELS: Record<string, string> = {
  generating: 'Generating',
  pending_validation: 'Pending Validation',
  validating: 'Validating',
  reviewing: 'Ready for Review',
  pending_submit: 'Submitting...',
  submitted: 'Submitted',
  failed: 'Failed',
};

// ============================================================
// Helpers
// ============================================================

function statusBadgeVariant(status: string): 'pending' | 'approved' | 'denied' | 'info' {
  switch (status) {
    case 'submitted':
      return 'approved';
    case 'reviewing':
      return 'pending';
    case 'failed':
      return 'denied';
    default:
      return 'info';
  }
}

function formatPrice(price: number | null | undefined): string {
  if (price == null) return '-';
  return `$${price.toFixed(2)}`;
}

function priceChangePercent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// ============================================================
// Main Component
// ============================================================

export function USFoodsPage() {
  const queryClient = useQueryClient();

  // Tab state
  const [activeTab, setActiveTab] = useState<'orders' | 'analytics'>('orders');

  // Run selector
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // Shop expand state
  const [expandedShops, setExpandedShops] = useState<Record<string, boolean>>({});

  // Add item modal
  const [addItemModal, setAddItemModal] = useState<{ shopMappingId: number; shopName: string } | null>(null);
  const [addItemProductId, setAddItemProductId] = useState<number | null>(null);
  const [addItemQuantity, setAddItemQuantity] = useState(1);
  const [addItemUnit, setAddItemUnit] = useState('CS');

  // ---- API Queries ----

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['usfoods-runs'],
    queryFn: usfoods.listRuns,
  });

  const runsList = (runs ?? []) as RunListItem[];

  // Auto-select latest run
  const effectiveRunId = selectedRunId ?? runsList[0]?.id ?? null;

  const { data: runDetail, isLoading: runDetailLoading } = useQuery({
    queryKey: ['usfoods-run', effectiveRunId],
    queryFn: () => usfoods.getRun(effectiveRunId!),
    enabled: !!effectiveRunId,
  });

  const run = runDetail as RunDetail | undefined;

  const { data: products } = useQuery({
    queryKey: ['usfoods-products'],
    queryFn: usfoods.listProducts,
  });

  const { data: shops } = useQuery({
    queryKey: ['usfoods-shops'],
    queryFn: usfoods.listShops,
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['usfoods-analytics'],
    queryFn: () => usfoods.getAnalytics(),
    enabled: activeTab === 'analytics',
  });

  const productList = (products ?? []) as Product[];
  const shopList = (shops ?? []) as Shop[];
  const analyticsData = analytics as AnalyticsData | undefined;

  // ---- Mutations ----

  const generateMutation = useMutation({
    mutationFn: usfoods.generateRun,
    onSuccess: (data: { id: number }) => {
      toast.success('New run generated successfully');
      queryClient.invalidateQueries({ queryKey: ['usfoods-runs'] });
      setSelectedRunId(data.id);
    },
    onError: () => toast.error('Failed to generate run'),
  });

  const submitMutation = useMutation({
    mutationFn: () => usfoods.submitRun(effectiveRunId!),
    onSuccess: () => {
      toast.success('Order submitted to US Foods');
      queryClient.invalidateQueries({ queryKey: ['usfoods-runs'] });
      queryClient.invalidateQueries({ queryKey: ['usfoods-run', effectiveRunId] });
    },
    onError: () => toast.error('Failed to submit order'),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: { quantity?: number; unit?: string; is_flagged?: boolean; flag_reason?: string | null } }) =>
      usfoods.updateItem(effectiveRunId!, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['usfoods-run', effectiveRunId] });
    },
    onError: () => toast.error('Failed to update item'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => usfoods.deleteItem(effectiveRunId!, itemId),
    onSuccess: () => {
      toast.success('Item removed');
      queryClient.invalidateQueries({ queryKey: ['usfoods-run', effectiveRunId] });
    },
    onError: () => toast.error('Failed to remove item'),
  });

  const addItemMutation = useMutation({
    mutationFn: (data: { product_id: number; shop_mapping_id: number; quantity: number; unit: string }) =>
      usfoods.addItem(effectiveRunId!, data),
    onSuccess: () => {
      toast.success('Item added');
      setAddItemModal(null);
      setAddItemProductId(null);
      setAddItemQuantity(1);
      setAddItemUnit('CS');
      queryClient.invalidateQueries({ queryKey: ['usfoods-run', effectiveRunId] });
    },
    onError: () => toast.error('Failed to add item'),
  });

  // ---- Derived data ----

  const summary = useMemo(() => {
    if (!run) return { totalItems: 0, flaggedItems: 0, shopsNeedingAttention: 0 };
    const totalItems = run.shops.reduce((sum, s) => sum + s.item_count, 0);
    const flaggedItems = run.shops.reduce((sum, s) => sum + s.flagged_count, 0);
    const shopsNeedingAttention = run.shops.filter(
      (s) => s.flagged_count > 0 || !s.meets_minimum,
    ).length;
    return { totalItems, flaggedItems, shopsNeedingAttention };
  }, [run]);

  const canSubmit = useMemo(() => {
    if (!run) return false;
    if (run.status !== 'reviewing') return false;
    return run.shops.every((s) => s.meets_minimum && s.flagged_count === 0);
  }, [run]);

  // Filler items: cheap products for meeting minimums
  const fillerProducts = useMemo(() => {
    return productList
      .filter((p) => p.current_price != null && p.current_price < 20)
      .sort((a, b) => (a.current_price ?? 999) - (b.current_price ?? 999))
      .slice(0, 10);
  }, [productList]);

  // ---- Handlers ----

  const toggleShop = useCallback((shopName: string) => {
    setExpandedShops((prev) => ({ ...prev, [shopName]: !prev[shopName] }));
  }, []);

  const handleQuantityChange = useCallback(
    (itemId: number, quantity: number) => {
      if (quantity < 1) return;
      updateItemMutation.mutate({ itemId, data: { quantity } });
    },
    [updateItemMutation],
  );

  const handleResolveFlagged = useCallback(
    (itemId: number) => {
      updateItemMutation.mutate({ itemId, data: { is_flagged: false, flag_reason: null } });
    },
    [updateItemMutation],
  );

  const handleAddItem = useCallback(() => {
    if (!addItemModal || !addItemProductId) {
      toast.error('Please select a product');
      return;
    }
    addItemMutation.mutate({
      product_id: addItemProductId,
      shop_mapping_id: addItemModal.shopMappingId,
      quantity: addItemQuantity,
      unit: addItemUnit,
    });
  }, [addItemModal, addItemProductId, addItemQuantity, addItemUnit, addItemMutation]);

  // Initialize expanded state for shops with issues
  const shopExpandState = useCallback(
    (shop: ShopData): boolean => {
      if (expandedShops[shop.shop_name] !== undefined) return expandedShops[shop.shop_name];
      return shop.flagged_count > 0 || !shop.meets_minimum;
    },
    [expandedShops],
  );

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <Truck className="h-7 w-7 text-[#5CB832]" />
          <h1 className="text-2xl font-bold text-gray-900">US Foods Orders</h1>
          {run && (
            <Badge variant={statusBadgeVariant(run.status)}>
              {STATUS_LABELS[run.status] ?? run.status}
            </Badge>
          )}
        </div>

        {/* Tab switcher */}
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            onClick={() => setActiveTab('orders')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'orders'
                ? 'bg-[#5CB832] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            <Package className="h-4 w-4" />
            Pending Orders
          </button>
          <button
            onClick={() => setActiveTab('analytics')}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'analytics'
                ? 'bg-[#5CB832] text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            <BarChart3 className="h-4 w-4" />
            Analytics
          </button>
        </div>
      </div>

      {activeTab === 'orders' ? (
        <>
          {/* Action bar */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {/* Run selector */}
            <div className="w-56">
              <Select
                options={runsList.map((r) => ({
                  value: r.id,
                  label: `${r.run_date} (${STATUS_LABELS[r.status] ?? r.status})`,
                }))}
                value={effectiveRunId ?? ''}
                onChange={(e) => setSelectedRunId(Number(e.target.value))}
                placeholder="Select run..."
              />
            </div>

            <Button
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              icon={<RefreshCw className="h-4 w-4" />}
            >
              Generate New Run
            </Button>

            <Button
              onClick={async () => {
                if (!effectiveRunId) return;
                try {
                  const result = await usfoods.downloadCsv(effectiveRunId);
                  const csv = result.csv_data;
                  if (!csv) { toast.error('No CSV data'); return; }
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `us_foods_import_${run?.run_date ?? 'export'}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast.success('CSV downloaded!');
                } catch { toast.error('Failed to generate CSV'); }
              }}
              disabled={!run || !run.shops?.length}
              icon={<Download className="h-4 w-4" />}
              className={clsx(
                run?.shops?.length
                  ? 'bg-[#5CB832] hover:bg-[#4a9628] text-white'
                  : '',
              )}
            >
              Download CSV
            </Button>
          </div>

          {/* Summary bar */}
          {run && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <Card>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center">
                    <Package className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Total Items</p>
                    <p className="text-xl font-bold text-gray-900">{summary.totalItems}</p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className={clsx(
                    'h-10 w-10 rounded-lg flex items-center justify-center',
                    summary.flaggedItems > 0 ? 'bg-red-50' : 'bg-green-50',
                  )}>
                    <AlertTriangle className={clsx(
                      'h-5 w-5',
                      summary.flaggedItems > 0 ? 'text-red-600' : 'text-green-600',
                    )} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Flagged Items</p>
                    <p className={clsx(
                      'text-xl font-bold',
                      summary.flaggedItems > 0 ? 'text-red-600' : 'text-gray-900',
                    )}>
                      {summary.flaggedItems}
                    </p>
                  </div>
                </div>
              </Card>
              <Card>
                <div className="flex items-center gap-3">
                  <div className={clsx(
                    'h-10 w-10 rounded-lg flex items-center justify-center',
                    summary.shopsNeedingAttention > 0 ? 'bg-orange-50' : 'bg-green-50',
                  )}>
                    <Truck className={clsx(
                      'h-5 w-5',
                      summary.shopsNeedingAttention > 0 ? 'text-orange-600' : 'text-green-600',
                    )} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Shops Need Attention</p>
                    <p className={clsx(
                      'text-xl font-bold',
                      summary.shopsNeedingAttention > 0 ? 'text-orange-600' : 'text-gray-900',
                    )}>
                      {summary.shopsNeedingAttention}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Loading state */}
          {(runsLoading || runDetailLoading) && (
            <div className="py-12">
              <LoadingSpinner label="Loading order data..." />
            </div>
          )}

          {/* No runs */}
          {!runsLoading && runsList.length === 0 && (
            <Card>
              <div className="text-center py-12 text-gray-400">
                <Truck className="h-10 w-10 mx-auto mb-3" />
                <p className="text-lg font-medium">No runs generated yet</p>
                <p className="text-sm mt-1">Click "Generate New Run" to pull in Square orders</p>
              </div>
            </Card>
          )}

          {/* Shop sections */}
          {run && !runDetailLoading && (
            <div className="space-y-3">
              {run.shops.map((shop) => {
                const isExpanded = shopExpandState(shop);
                const hasIssues = shop.flagged_count > 0 || !shop.meets_minimum;

                return (
                  <Card key={shop.customer_number} padding={false}>
                    {/* Shop header */}
                    <button
                      onClick={() => toggleShop(shop.shop_name)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900">{shop.shop_name}</span>
                          <span className="text-xs text-gray-500">#{shop.customer_number}</span>
                          {shop.is_alias && (
                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">→ shared account</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-sm text-gray-500">
                          <span>{shop.item_count} items{(shop.combined_count ?? shop.item_count) !== shop.item_count ? ` (${shop.combined_count} combined)` : ''}</span>
                          {!shop.meets_minimum && (
                            <span className="text-orange-600 font-medium">
                              Need {MINIMUM_ITEMS - (shop.combined_count ?? shop.item_count)} more
                            </span>
                          )}
                          {shop.flagged_count > 0 && (
                            <span className="text-red-600 font-medium">
                              {shop.flagged_count} flagged
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status indicator */}
                      <div className="flex-shrink-0">
                        {hasIssues ? (
                          <div className={clsx(
                            'h-8 w-8 rounded-full flex items-center justify-center',
                            shop.flagged_count > 0 ? 'bg-red-100' : 'bg-orange-100',
                          )}>
                            <AlertTriangle className={clsx(
                              'h-4 w-4',
                              shop.flagged_count > 0 ? 'text-red-600' : 'text-orange-600',
                            )} />
                          </div>
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          </div>
                        )}
                      </div>
                    </button>

                    {/* Combine dropdown — only show if under minimum */}
                    {!shop.meets_minimum && run && (
                      <div className="px-4 py-2 bg-orange-50 border-t border-orange-200 flex items-center gap-3">
                        <span className="text-sm text-orange-700 font-medium">Combine with:</span>
                        <select
                          className="text-sm rounded border border-orange-300 px-2 py-1 bg-white"
                          defaultValue=""
                          onChange={async (e) => {
                            const toId = Number(e.target.value);
                            if (!toId || !effectiveRunId) return;
                            const fromMapping = shopList.find((s) => s.customer_number === shop.customer_number && !s.is_routing_alias);
                            const fromId = fromMapping?.id;
                            if (!fromId) { toast.error('Could not find shop mapping'); return; }
                            try {
                              await usfoods.combineShops(effectiveRunId, fromId, toId);
                              queryClient.invalidateQueries({ queryKey: ['usfoods-run'] });
                              toast.success(`Moved ${shop.item_count} items`);
                            } catch { toast.error('Failed to combine'); }
                          }}
                        >
                          <option value="">Select a store...</option>
                          {(() => {
                            // Group other shops by customer number for the dropdown
                            const grouped: Record<string, { names: string[]; totalItems: number; mappingId: number }> = {};
                            run.shops
                              .filter((s) => s.customer_number !== shop.customer_number)
                              .forEach((s) => {
                                if (!grouped[s.customer_number]) {
                                  const mapping = shopList.find((m) => m.customer_number === s.customer_number && !m.is_routing_alias);
                                  grouped[s.customer_number] = { names: [], totalItems: 0, mappingId: mapping?.id ?? 0 };
                                }
                                grouped[s.customer_number].names.push(s.shop_name);
                                grouped[s.customer_number].totalItems += s.item_count;
                              });
                            return Object.entries(grouped).map(([custNum, g]) => (
                              g.mappingId ? (
                                <option key={custNum} value={g.mappingId}>
                                  {g.names.join(' + ')} ({g.totalItems} items)
                                </option>
                              ) : null
                            ));
                          })()}
                        </select>
                      </div>
                    )}

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t border-gray-200">
                        {/* Items table */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wide">
                                <th className="px-4 py-2 font-medium">Product</th>
                                <th className="px-4 py-2 font-medium">US Foods #</th>
                                <th className="px-4 py-2 font-medium w-24">Qty</th>
                                <th className="px-4 py-2 font-medium w-16">Unit</th>
                                <th className="px-4 py-2 font-medium">Status</th>
                                <th className="px-4 py-2 font-medium w-10"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {shop.items.map((item) => (
                                <tr
                                  key={item.id}
                                  className={clsx(
                                    'transition-colors',
                                    item.is_flagged ? 'bg-red-50' : 'hover:bg-gray-50',
                                  )}
                                >
                                  <td className="px-4 py-2">
                                    <div>
                                      <p className="font-medium text-gray-900">
                                        {item.product_description ?? item.square_item_name ?? 'Unknown Product'}
                                      </p>
                                      {item.is_filler && (
                                        <span className="text-xs text-purple-600 font-medium">Filler</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-2 text-gray-600 font-mono text-xs">
                                    {item.product_number ?? '-'}
                                  </td>
                                  <td className="px-4 py-2">
                                    <input
                                      type="number"
                                      min={1}
                                      value={item.quantity}
                                      onChange={(e) =>
                                        handleQuantityChange(item.id, parseInt(e.target.value) || 1)
                                      }
                                      className="h-7 w-16 rounded border border-gray-300 text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    />
                                  </td>
                                  <td className="px-4 py-2">
                                    <button
                                      onClick={() =>
                                        updateItemMutation.mutate({
                                          itemId: item.id,
                                          data: { unit: item.unit === 'CS' ? 'EA' : 'CS' },
                                        })
                                      }
                                      className="px-2 py-0.5 rounded border border-gray-300 text-xs font-medium hover:bg-gray-100 transition-colors"
                                    >
                                      {item.unit}
                                    </button>
                                  </td>
                                  <td className="px-4 py-2">
                                    {item.is_flagged ? (
                                      <div className="flex items-center gap-1.5">
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                          <AlertTriangle className="h-3 w-3" />
                                          {item.flag_reason?.replace(/_/g, ' ') ?? 'flagged'}
                                        </span>
                                        <button
                                          onClick={() => handleResolveFlagged(item.id)}
                                          className="text-xs text-blue-600 hover:text-blue-800 underline"
                                        >
                                          Resolve
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-green-600 text-xs font-medium">OK</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2">
                                    <button
                                      onClick={() => {
                                        if (confirm('Remove this item?')) {
                                          deleteItemMutation.mutate(item.id);
                                        }
                                      }}
                                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Action buttons */}
                        <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Plus className="h-3.5 w-3.5" />}
                            onClick={() => {
                              const shopMapping = shopList.find(
                                (s) => s.customer_number === shop.customer_number,
                              );
                              if (shopMapping) {
                                setAddItemModal({
                                  shopMappingId: shopMapping.id,
                                  shopName: shop.shop_name,
                                });
                              } else {
                                toast.error('Shop mapping not found');
                              }
                            }}
                          >
                            Add Item
                          </Button>
                          {!shop.meets_minimum && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                const shopMapping = shopList.find(
                                  (s) => s.customer_number === shop.customer_number,
                                );
                                if (shopMapping && fillerProducts.length > 0) {
                                  setAddItemModal({
                                    shopMappingId: shopMapping.id,
                                    shopName: shop.shop_name,
                                  });
                                  // Pre-select cheapest filler
                                  setAddItemProductId(fillerProducts[0].id);
                                } else {
                                  toast.error('No filler products available');
                                }
                              }}
                              className="text-purple-600 border-purple-200 hover:bg-purple-50"
                            >
                              Add Filler
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Analytics Tab */
        <AnalyticsView data={analyticsData} loading={analyticsLoading} />
      )}

      {/* Add Item Modal */}
      <Modal
        open={!!addItemModal}
        onClose={() => {
          setAddItemModal(null);
          setAddItemProductId(null);
          setAddItemQuantity(1);
          setAddItemUnit('CS');
        }}
        title={`Add Item to ${addItemModal?.shopName ?? ''}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
            <select
              value={addItemProductId ?? ''}
              onChange={(e) => setAddItemProductId(Number(e.target.value) || null)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832]"
            >
              <option value="">Select a product...</option>
              {fillerProducts.length > 0 && (
                <optgroup label="Filler Items (under $20)">
                  {fillerProducts.map((p) => (
                    <option key={`filler-${p.id}`} value={p.id}>
                      {p.description} ({p.product_number}) - {formatPrice(p.current_price)}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label="All Products">
                {productList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.description} ({p.product_number}) {p.current_price != null ? `- ${formatPrice(p.current_price)}` : ''}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Quantity"
              type="number"
              min={1}
              value={addItemQuantity}
              onChange={(e) => setAddItemQuantity(parseInt(e.target.value) || 1)}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
              <select
                value={addItemUnit}
                onChange={(e) => setAddItemUnit(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832]"
              >
                <option value="CS">CS (Case)</option>
                <option value="EA">EA (Each)</option>
                <option value="LB">LB (Pound)</option>
                <option value="BG">BG (Bag)</option>
              </select>
            </div>
          </div>

          <Button
            onClick={handleAddItem}
            loading={addItemMutation.isPending}
            className="w-full bg-[#5CB832] hover:bg-[#4a9628]"
          >
            Add Item
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// Analytics Sub-component
// ============================================================

function AnalyticsView({ data, loading }: { data: AnalyticsData | undefined; loading: boolean }) {
  if (loading) {
    return (
      <div className="py-12">
        <LoadingSpinner label="Loading analytics..." />
      </div>
    );
  }

  if (!data) {
    return (
      <Card>
        <div className="text-center py-12 text-gray-400">
          <BarChart3 className="h-10 w-10 mx-auto mb-3" />
          <p>No analytics data available</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Consumption chart (simplified as table) */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[#5CB832]" />
          Weekly Order Volume
        </h3>
        {data.recent_runs.length === 0 ? (
          <p className="text-sm text-gray-500">No run history yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b">
                  <th className="pb-2 font-medium">Week</th>
                  <th className="pb-2 font-medium">Items</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Volume</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recent_runs.map((run) => {
                  const maxItems = Math.max(...data.recent_runs.map((r) => r.total_line_items), 1);
                  const pct = (run.total_line_items / maxItems) * 100;
                  return (
                    <tr key={run.id}>
                      <td className="py-2 text-gray-900">{run.run_date}</td>
                      <td className="py-2 font-medium">{run.total_line_items}</td>
                      <td className="py-2">
                        <Badge variant={statusBadgeVariant(run.status)}>
                          {STATUS_LABELS[run.status] ?? run.status}
                        </Badge>
                      </td>
                      <td className="py-2 w-40">
                        <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#5CB832] rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Price changes */}
      <Card>
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-orange-500" />
          Price Changes
        </h3>
        {data.price_changes.length === 0 ? (
          <p className="text-sm text-gray-500">No recent price changes</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b">
                  <th className="pb-2 font-medium">Product</th>
                  <th className="pb-2 font-medium">Previous</th>
                  <th className="pb-2 font-medium">Current</th>
                  <th className="pb-2 font-medium">Change</th>
                  <th className="pb-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.price_changes.map((item, i) => {
                  const change = priceChangePercent(item.current_price, item.previous_price);
                  return (
                    <tr key={i}>
                      <td className="py-2">
                        <p className="font-medium text-gray-900">{item.description}</p>
                        <p className="text-xs text-gray-500 font-mono">{item.product_number}</p>
                      </td>
                      <td className="py-2 text-gray-600">{formatPrice(item.previous_price)}</td>
                      <td className="py-2 font-medium text-gray-900">{formatPrice(item.current_price)}</td>
                      <td className="py-2">
                        {change != null && (
                          <span
                            className={clsx(
                              'inline-flex items-center gap-0.5 text-xs font-medium',
                              change > 0 ? 'text-red-600' : 'text-green-600',
                            )}
                          >
                            {change > 0 ? (
                              <TrendingUp className="h-3 w-3" />
                            ) : (
                              <TrendingDown className="h-3 w-3" />
                            )}
                            {Math.abs(change).toFixed(1)}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-xs text-gray-500">
                        {item.price_updated_at
                          ? new Date(item.price_updated_at).toLocaleDateString()
                          : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
