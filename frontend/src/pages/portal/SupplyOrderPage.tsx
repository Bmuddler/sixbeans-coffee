import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, X, Minus, Plus, Trash2, Package, History, ChevronRight, Edit3, Copy, PlusCircle, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { toast } from 'react-hot-toast';
import { useAuthStore } from '@/stores/authStore';
import { supplyOrders, locations as locationsApi } from '@/lib/api';
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

interface CatalogItem {
  id: number;
  name: string;
  description: string;
  category: string;
  price: number;
  unit?: string;
  pack_size?: number | null;
  pack_unit?: string | null;
  is_count_item?: boolean;
  density_oz_per_cup?: number | null;
  cost_per_base_unit?: number | null;
  base_unit?: string | null;
  supplier?: string | null;
  usfoods_pn?: string | null;
}

const SUPPLIER_OPTIONS = [
  { value: '', label: '—' },
  { value: 'WAREHOUSE', label: 'Warehouse' },
  { value: 'BAKERY', label: 'Bakery' },
  { value: 'DAIRY', label: 'Dairy' },
  { value: 'US FOODS', label: 'US Foods' },
  { value: 'COSTCO', label: 'Costco' },
  { value: 'WINCO', label: 'WinCo' },
  { value: 'WEBSTAURANT', label: 'Webstaurant' },
  { value: 'KLATCH', label: 'Klatch' },
  { value: 'OLD TOWN BAKING', label: 'Old Town Baking' },
  { value: 'BANK', label: 'Bank' },
  { value: 'OTHER', label: 'Other' },
];

const UNIT_OPTIONS = [
  { value: '', label: '—' },
  { value: 'oz', label: 'oz (weight)' },
  { value: 'lb', label: 'lb' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'floz', label: 'fl oz' },
  { value: 'cup', label: 'cup' },
  { value: 'tbsp', label: 'tbsp' },
  { value: 'tsp', label: 'tsp' },
  { value: 'gal', label: 'gallon' },
  { value: 'qt', label: 'quart' },
  { value: 'pt', label: 'pint' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'liter' },
  { value: 'each', label: 'each (count)' },
];

interface CartItem {
  supply_item_id: number;
  name: string;
  category: string;
  description: string;
  price: number;
  quantity: number;
}

interface OrderRecord {
  id: number;
  location_id: number;
  location_name?: string | null;
  ordered_by?: number | null;
  orderer_name?: string | null;
  status: string;
  notes?: string;
  created_at: string;
  items: { supply_item_id: number; item_name?: string; item_price?: number; quantity: number }[];
  total?: number;
}

// ============================================================
// Constants
// ============================================================

// Categories are derived dynamically from the catalog response

const CART_STORAGE_KEY = 'sixbeans_supply_cart';

// ============================================================
// Helpers
// ============================================================

function loadCart(): CartItem[] {
  try {
    const raw = sessionStorage.getItem(CART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCart(cart: CartItem[]) {
  sessionStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
}

function formatPrice(cents: number) {
  return `$${cents.toFixed(2)}`;
}

function statusBadgeVariant(status: string): 'pending' | 'approved' | 'denied' | 'info' {
  switch (status) {
    case 'pending': return 'pending';
    case 'confirmed':
    case 'delivered': return 'approved';
    case 'cancelled': return 'denied';
    default: return 'info';
  }
}

// ============================================================
// Component
// ============================================================

export function SupplyOrderPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isOwner = user?.role === 'owner';

  // View toggle
  const [view, setView] = useState<'order' | 'history' | 'manage'>('order');

  // Category
  const [activeCategory, setActiveCategory] = useState<string>('');

  // Selection state: which items are checked and their quantities
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  // Cart
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [cartOpen, setCartOpen] = useState(false);

  // Review modal
  const [reviewOpen, setReviewOpen] = useState(false);

  // Location
  const [locationId, setLocationId] = useState<number>(user?.location_ids?.[0] ?? 0);

  // Notes
  const [notes, setNotes] = useState('');

  // Order detail
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null);

  // Catalog management (owner only)
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [itemForm, setItemForm] = useState({
    name: '',
    category: '',
    description: '',
    price: '',
    pack_size: '',
    pack_unit: '',
    is_count_item: false,
    density_oz_per_cup: '',
    supplier: '',
    usfoods_pn: '',
  });
  const [manageCategory, setManageCategory] = useState<string>('');

  // Persist cart
  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  // ---- API ----

  const { data: catalog, isLoading: catalogLoading } = useQuery({
    queryKey: ['supply-catalog'],
    queryFn: supplyOrders.getCatalog,
  });

  const { data: allLocations } = useQuery({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const { data: orders, isLoading: ordersLoading, refetch: refetchOrders } = useQuery({
    queryKey: ['supply-orders'],
    queryFn: supplyOrders.getOrders,
    enabled: view === 'history',
  });

  const submitMutation = useMutation({
    mutationFn: supplyOrders.submitOrder,
    onSuccess: () => {
      toast.success('Order submitted successfully!');
      setCart([]);
      setNotes('');
      setReviewOpen(false);
      setView('history');
      refetchOrders();
    },
    onError: () => {
      toast.error('Failed to submit order. Please try again.');
    },
  });

  // Catalog CRUD mutations (owner)
  const createItemMutation = useMutation({
    mutationFn: supplyOrders.createCatalogItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-catalog'] });
      setShowAddItem(false);
      setItemForm({ name: '', category: '', description: '', price: '', pack_size: '', pack_unit: '', is_count_item: false, density_oz_per_cup: '', supplier: '', usfoods_pn: '' });
      toast.success('Item added');
    },
    onError: () => toast.error('Failed to add item'),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => supplyOrders.updateCatalogItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-catalog'] });
      setEditingItem(null);
      toast.success('Item updated');
    },
    onError: () => toast.error('Failed to update item'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: supplyOrders.deleteCatalogItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-catalog'] });
      toast.success('Item removed');
    },
    onError: () => toast.error('Failed to remove item'),
  });

  const copyItemMutation = useMutation({
    mutationFn: supplyOrders.copyCatalogItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-catalog'] });
      toast.success('Item copied');
    },
    onError: () => toast.error('Failed to copy item'),
  });

  const autoFillUnitsMutation = useMutation({
    mutationFn: (overwrite: boolean) => supplyOrders.autoFillCatalogUnits(overwrite),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['supply-catalog'] });
      toast.success(
        `Auto-filled ${resp.filled} item(s)${resp.unrecognised_count ? ` · ${resp.unrecognised_count} still need manual review` : ''}.`,
      );
    },
    onError: () => toast.error('Auto-fill failed'),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: supplyOrders.deleteOrder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-orders'] });
      setSelectedOrder(null);
      toast.success('Order deleted');
    },
    onError: () => toast.error('Failed to delete order'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => supplyOrders.updateStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supply-orders'] });
      setSelectedOrder(null);
      toast.success('Order status updated');
    },
    onError: () => toast.error('Failed to update order status'),
  });

  // ---- Derived ----

  const catalogItems: CatalogItem[] = useMemo(() => {
    if (!catalog) return [];
    if (Array.isArray(catalog)) return catalog;
    const cats = (catalog as any).categories;
    if (Array.isArray(cats)) {
      return cats.flatMap((cat: any) =>
        (cat.items ?? []).map((item: any) => ({ ...item, category: cat.name }))
      );
    }
    return [];
  }, [catalog]);

  const categories = useMemo(() => {
    const unique = [...new Set(catalogItems.map((item) => item.category))];
    return unique.sort();
  }, [catalogItems]);

  useEffect(() => {
    if (categories.length > 0 && !activeCategory) {
      setActiveCategory(categories[0]);
    }
    if (categories.length > 0 && !manageCategory) {
      setManageCategory(categories[0]);
    }
  }, [categories, activeCategory, manageCategory]);

  const manageCategoryItems = useMemo(
    () => catalogItems.filter((item) => !manageCategory || item.category === manageCategory),
    [catalogItems, manageCategory],
  );

  const categoryItems = useMemo(
    () => catalogItems.filter((item) => item.category === activeCategory),
    [catalogItems, activeCategory],
  );

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const locationOptions = useMemo(() => {
    if (!allLocations) return [];
    const locs = user?.location_ids?.length
      ? allLocations.filter((l) => user.location_ids!.includes(l.id))
      : allLocations;
    return locs.map((l) => ({ value: l.id, label: l.name }));
  }, [allLocations, user?.location_ids]);

  useEffect(() => {
    if (!locationId && locationOptions.length > 0) {
      setLocationId(locationOptions[0].value);
    }
  }, [locationId, locationOptions]);

  // ---- Handlers ----

  const toggleCheck = useCallback((item: CatalogItem) => {
    setChecked((prev) => {
      const next = { ...prev, [item.id]: !prev[item.id] };
      if (next[item.id]) {
        // Auto-set quantity to 1 when checking
        setQuantities((q) => ({ ...q, [item.id]: q[item.id] || 1 }));
      }
      return next;
    });
  }, []);

  const setQty = useCallback((id: number, qty: number) => {
    const val = Math.max(1, qty);
    setQuantities((prev) => ({ ...prev, [id]: val }));
    // Auto-check when quantity changes
    setChecked((prev) => ({ ...prev, [id]: true }));
  }, []);

  const addSelectedToCart = useCallback(() => {
    const selectedItems = categoryItems.filter((item) => checked[item.id]);
    if (selectedItems.length === 0) {
      toast.error('No items selected');
      return;
    }

    setCart((prev) => {
      const updated = [...prev];
      for (const item of selectedItems) {
        const qty = quantities[item.id] || 1;
        const existing = updated.findIndex((c) => c.supply_item_id === item.id);
        if (existing >= 0) {
          updated[existing].quantity += qty;
        } else {
          updated.push({
            supply_item_id: item.id,
            name: item.name,
            category: item.category,
            description: item.description,
            price: item.price,
            quantity: qty,
          });
        }
      }
      return updated;
    });

    toast.success(`${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''} added to order`);

    // Reset selections
    setChecked({});
    setQuantities({});
  }, [categoryItems, checked, quantities]);

  const updateCartQty = useCallback((supplyItemId: number, qty: number) => {
    if (qty < 1) {
      setCart((prev) => prev.filter((c) => c.supply_item_id !== supplyItemId));
    } else {
      setCart((prev) =>
        prev.map((c) => (c.supply_item_id === supplyItemId ? { ...c, quantity: qty } : c)),
      );
    }
  }, []);

  const removeFromCart = useCallback((supplyItemId: number) => {
    setCart((prev) => prev.filter((c) => c.supply_item_id !== supplyItemId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    toast.success('Cart cleared');
  }, []);

  const handleSubmit = useCallback(() => {
    if (!locationId) {
      toast.error('Please select a location');
      return;
    }
    if (cart.length === 0) {
      toast.error('Cart is empty');
      return;
    }
    submitMutation.mutate({
      location_id: locationId,
      notes: notes || undefined,
      items: cart.map((c) => ({ supply_item_id: c.supply_item_id, quantity: c.quantity })),
    });
  }, [locationId, cart, notes, submitMutation]);

  // ---- Cart grouped by category ----
  const cartByCategory = useMemo(() => {
    const groups: Record<string, CartItem[]> = {};
    for (const item of cart) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }, [cart]);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="max-w-7xl mx-auto">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Order Supplies</h1>
          {view === 'order' && (
            <button
              onClick={() => setCartOpen(!cartOpen)}
              className="relative p-2 rounded-lg hover:bg-gray-100 transition-colors lg:hidden"
            >
              <ShoppingCart className="h-6 w-6 text-gray-600" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center h-5 min-w-[20px] rounded-full bg-red-500 text-white text-xs font-bold px-1">
                  {cartCount}
                </span>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          {locationOptions.length > 1 && (
            <div className="w-48">
              <Select
                options={locationOptions}
                value={locationId}
                onChange={(e) => setLocationId(Number(e.target.value))}
                placeholder="Select location"
              />
            </div>
          )}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              onClick={() => setView('order')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                view === 'order'
                  ? 'bg-[#5CB832] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              <Package className="h-4 w-4" />
              New Order
            </button>
            <button
              onClick={() => setView('history')}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                view === 'history'
                  ? 'bg-[#5CB832] text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              <History className="h-4 w-4" />
              Order History
            </button>
            {isOwner && (
              <button
                onClick={() => setView('manage')}
                className={clsx(
                  'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                  view === 'manage'
                    ? 'bg-[#5CB832] text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50',
                )}
              >
                <Settings className="h-4 w-4" />
                Manage Catalog
              </button>
            )}
          </div>
        </div>
      </div>

      {view === 'order' ? (
        <div className="flex gap-4">
          {/* Main content */}
          <div className="flex-1 min-w-0">
            {/* Category tabs */}
            <div className="mb-4 -mx-1 overflow-x-auto scrollbar-thin">
              <div className="flex gap-1 px-1 pb-1">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => {
                      setActiveCategory(cat);
                      setChecked({});
                      setQuantities({});
                    }}
                    className={clsx(
                      'whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors flex-shrink-0',
                      activeCategory === cat
                        ? 'bg-[#5CB832] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Item list */}
            <Card padding={false}>
              {catalogLoading ? (
                <div className="py-12">
                  <LoadingSpinner label="Loading catalog..." />
                </div>
              ) : categoryItems.length === 0 ? (
                <div className="py-12 text-center text-gray-500">
                  No items in this category
                </div>
              ) : (
                <>
                  <div className="divide-y divide-gray-100">
                    {categoryItems.map((item) => {
                      const isChecked = !!checked[item.id];
                      const qty = quantities[item.id] || 1;
                      return (
                        <div
                          key={item.id}
                          className={clsx(
                            'flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer',
                            isChecked ? 'bg-green-50' : 'hover:bg-gray-50',
                          )}
                          onClick={() => toggleCheck(item)}
                        >
                          {/* Checkbox */}
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCheck(item)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-5 w-5 rounded border-gray-300 flex-shrink-0 cursor-pointer"
                            style={{ accentColor: '#5CB832' }}
                          />

                          {/* Item info */}
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                            <p className="text-xs text-gray-500 truncate">
                              {item.description}
                              {item.unit ? ` \u00b7 ${item.unit}` : ''}
                            </p>
                            <p className="text-sm font-medium text-[#5CB832]">
                              {formatPrice(item.price)}
                            </p>
                          </div>

                          {/* Quantity input */}
                          <div
                            className="flex items-center gap-1 flex-shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => setQty(item.id, qty - 1)}
                              className="h-7 w-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                              disabled={qty <= 1}
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={qty}
                              onChange={(e) => setQty(item.id, parseInt(e.target.value) || 1)}
                              className="h-7 w-12 rounded border border-gray-300 text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            <button
                              onClick={() => setQty(item.id, qty + 1)}
                              className="h-7 w-7 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Add to order button */}
                  <div className="p-3 border-t border-gray-200">
                    <Button
                      onClick={addSelectedToCart}
                      className="w-full"
                      disabled={!Object.values(checked).some(Boolean)}
                    >
                      Add Selected to Order
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* Cart panel - desktop */}
          <div className="hidden lg:block w-80 flex-shrink-0">
            <CartPanel
              cart={cart}
              cartByCategory={cartByCategory}
              cartCount={cartCount}
              cartTotal={cartTotal}
              onUpdateQty={updateCartQty}
              onRemove={removeFromCart}
              onClear={clearCart}
              onReview={() => setReviewOpen(true)}
            />
          </div>

          {/* Cart panel - mobile bottom sheet */}
          {cartOpen && (
            <div className="fixed inset-0 z-40 lg:hidden">
              <div className="absolute inset-0 bg-black/50" onClick={() => setCartOpen(false)} />
              <div className="absolute bottom-0 left-0 right-0 max-h-[75vh] bg-white rounded-t-2xl shadow-xl overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-gray-200 p-3 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Cart ({cartCount})</h3>
                  <button onClick={() => setCartOpen(false)} className="p-1 rounded hover:bg-gray-100">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="p-3">
                  <CartPanel
                    cart={cart}
                    cartByCategory={cartByCategory}
                    cartCount={cartCount}
                    cartTotal={cartTotal}
                    onUpdateQty={updateCartQty}
                    onRemove={removeFromCart}
                    onClear={clearCart}
                    onReview={() => {
                      setCartOpen(false);
                      setReviewOpen(true);
                    }}
                    embedded
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      ) : view === 'history' ? (
        /* Order History */
        <OrderHistoryView
          orders={orders ?? []}
          loading={ordersLoading}
          allLocations={allLocations ?? []}
          selectedOrder={selectedOrder}
          onSelectOrder={setSelectedOrder}
          isOwner={!!isOwner}
          onDeleteOrder={(id) => {
            if (confirm('Delete this order?')) deleteOrderMutation.mutate(id);
          }}
          onUpdateStatus={(id, status) => updateStatusMutation.mutate({ id, status })}
        />
      ) : (
        /* Manage Catalog (owner only) */
        <div>
          {/* Category filter + Add button */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex gap-1 flex-wrap flex-1">
              <button
                onClick={() => setManageCategory('')}
                className={clsx(
                  'whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  !manageCategory ? 'bg-[#5CB832] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                All
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setManageCategory(cat)}
                  className={clsx(
                    'whitespace-nowrap px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                    manageCategory === cat ? 'bg-[#5CB832] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                loading={autoFillUnitsMutation.isPending}
                onClick={() => autoFillUnitsMutation.mutate(false)}
                title="Heuristic parser fills pack size + unit + count flag from each item's name and description, only on items that don't have one yet"
              >
                Auto-fill pack info
              </Button>
              <Button
                icon={<PlusCircle className="h-4 w-4" />}
                onClick={() => {
                  setItemForm({ name: '', category: manageCategory || categories[0] || '', description: '', price: '', pack_size: '', pack_unit: '', is_count_item: false, density_oz_per_cup: '', supplier: '', usfoods_pn: '' });
                  setShowAddItem(true);
                }}
              >
                Add Item
              </Button>
            </div>
          </div>

          {/* Items list */}
          <Card padding={false}>
            <div className="divide-y divide-gray-100">
              {manageCategoryItems.length === 0 ? (
                <div className="py-12 text-center text-gray-500">No items in this category</div>
              ) : (
                manageCategoryItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                      <p className="text-xs text-gray-500">
                        {item.category} {item.description ? `\u00b7 ${item.description}` : ''}
                      </p>
                      <p className="text-sm font-medium text-[#5CB832]">
                        {item.price != null ? formatPrice(item.price) : 'No price'}
                        {item.pack_size != null && item.pack_unit && (
                          <span className="ml-2 text-xs font-normal text-gray-500">
                            · {item.pack_size} {item.pack_unit}
                            {item.cost_per_base_unit != null && (
                              <> · ${item.cost_per_base_unit.toFixed(4)}/{item.base_unit}</>
                            )}
                          </span>
                        )}
                        {item.is_count_item && !item.pack_size && (
                          <span className="ml-2 text-xs font-normal text-gray-500">· count item</span>
                        )}
                        {item.supplier && (
                          <span className="ml-2 text-xs font-normal text-gray-500">
                            · from {item.supplier}{item.usfoods_pn ? ` PN:${item.usfoods_pn}` : ''}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          setEditingItem(item);
                          setItemForm({
                            name: item.name,
                            category: item.category,
                            description: item.description || '',
                            price: item.price != null ? String(item.price) : '',
                            pack_size: item.pack_size != null ? String(item.pack_size) : '',
                            pack_unit: item.pack_unit ?? '',
                            is_count_item: !!item.is_count_item,
                            density_oz_per_cup: item.density_oz_per_cup != null ? String(item.density_oz_per_cup) : '',
                            supplier: item.supplier ?? '',
                            usfoods_pn: item.usfoods_pn ?? '',
                          });
                        }}
                        className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                        title="Edit"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => copyItemMutation.mutate(item.id)}
                        className="p-1.5 rounded text-gray-400 hover:text-purple-600 hover:bg-purple-50"
                        title="Copy"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove "${item.name}" from the catalog?`)) {
                            deleteItemMutation.mutate(item.id);
                          }
                        }}
                        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                        title="Remove"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Add Item Modal */}
          <Modal open={showAddItem} onClose={() => setShowAddItem(false)} title="Add Catalog Item">
            <div className="space-y-3">
              <Input
                label="Name"
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Item name"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={itemForm.category}
                  onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832]"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                  <option value="__new__">+ New Category</option>
                </select>
                {itemForm.category === '__new__' && (
                  <Input
                    className="mt-2"
                    placeholder="New category name"
                    value=""
                    onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
                  />
                )}
              </div>
              <Input
                label="Description"
                value={itemForm.description}
                onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="e.g. Case of 6"
              />
              <Input
                label="Pack price (what we pay for one pack/case)"
                type="number"
                step="0.01"
                value={itemForm.price}
                onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0.00"
              />
              <CatalogUnitFields itemForm={itemForm} setItemForm={setItemForm} />
              <CatalogSupplierFields itemForm={itemForm} setItemForm={setItemForm} />
              <Button
                className="w-full"
                onClick={() => {
                  if (!itemForm.name.trim() || !itemForm.category.trim()) {
                    toast.error('Name and category are required');
                    return;
                  }
                  createItemMutation.mutate({
                    name: itemForm.name.trim(),
                    category: itemForm.category.trim(),
                    description: itemForm.description.trim() || undefined,
                    price: itemForm.price ? parseFloat(itemForm.price) : undefined,
                    pack_size: itemForm.pack_size ? parseFloat(itemForm.pack_size) : undefined,
                    pack_unit: itemForm.pack_unit || undefined,
                    is_count_item: itemForm.is_count_item,
                    density_oz_per_cup: itemForm.density_oz_per_cup ? parseFloat(itemForm.density_oz_per_cup) : undefined,
                    supplier: itemForm.supplier || undefined,
                    usfoods_pn: itemForm.usfoods_pn.trim() || undefined,
                  });
                }}
                loading={createItemMutation.isPending}
              >
                Add Item
              </Button>
            </div>
          </Modal>

          {/* Edit Item Modal */}
          <Modal open={!!editingItem} onClose={() => setEditingItem(null)} title="Edit Catalog Item">
            <div className="space-y-3">
              <Input
                label="Name"
                value={itemForm.name}
                onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                <select
                  value={itemForm.category}
                  onChange={(e) => setItemForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832]"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <Input
                label="Description"
                value={itemForm.description}
                onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
              />
              <Input
                label="Pack price"
                type="number"
                step="0.01"
                value={itemForm.price}
                onChange={(e) => setItemForm((f) => ({ ...f, price: e.target.value }))}
              />
              <CatalogUnitFields itemForm={itemForm} setItemForm={setItemForm} />
              <CatalogSupplierFields itemForm={itemForm} setItemForm={setItemForm} />
              <Button
                className="w-full"
                onClick={() => {
                  if (!editingItem) return;
                  updateItemMutation.mutate({
                    id: editingItem.id,
                    data: {
                      name: itemForm.name.trim(),
                      category: itemForm.category.trim(),
                      description: itemForm.description.trim() || undefined,
                      price: itemForm.price ? parseFloat(itemForm.price) : undefined,
                      pack_size: itemForm.pack_size ? parseFloat(itemForm.pack_size) : null,
                      pack_unit: itemForm.pack_unit || null,
                      is_count_item: itemForm.is_count_item,
                      density_oz_per_cup: itemForm.density_oz_per_cup ? parseFloat(itemForm.density_oz_per_cup) : null,
                      supplier: itemForm.supplier || null,
                      usfoods_pn: itemForm.usfoods_pn.trim() || null,
                    },
                  });
                }}
                loading={updateItemMutation.isPending}
              >
                Save Changes
              </Button>
            </div>
          </Modal>
        </div>
      )}

      {/* Review / Submit Modal */}
      <Modal open={reviewOpen} onClose={() => setReviewOpen(false)} title="Review Order" size="lg">
        {/* Flex column inside the modal body. Items list is the only thing
             that scrolls; total + notes + Submit stay pinned in view so
             the order can always be submitted no matter how big the cart. */}
        <div className="flex flex-col gap-4 -m-6 h-full">
          <div className="flex-shrink-0 px-6 pt-6 space-y-3">
            {locationOptions.length > 1 && (
              <Select
                label="Location"
                options={locationOptions}
                value={locationId}
                onChange={(e) => setLocationId(Number(e.target.value))}
                placeholder="Select location"
              />
            )}
            {locationOptions.length === 1 && (
              <p className="text-sm text-gray-600">
                <span className="font-medium">Location:</span> {locationOptions[0].label}
              </p>
            )}
          </div>

          {/* Items — flex-1 so it eats the remaining vertical space */}
          <div className="flex-1 min-h-0 overflow-y-auto px-6 border-y border-gray-100">
            <div className="divide-y divide-gray-100">
              {cart.map((item) => (
                <div key={item.supply_item_id} className="flex items-center gap-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">{item.category}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateCartQty(item.supply_item_id, parseInt(e.target.value) || 1)
                      }
                      className="h-7 w-14 rounded border border-gray-300 text-center text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-sm font-medium text-gray-700 w-16 text-right">
                      {formatPrice(item.price * item.quantity)}
                    </span>
                    <button
                      onClick={() => removeFromCart(item.supply_item_id)}
                      className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sticky footer — total + notes + submit always visible */}
          <div className="flex-shrink-0 px-6 pb-6 space-y-3 bg-white">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-gray-900">Total ({cartCount} items)</span>
              <span className="text-lg font-bold text-[#5CB832]">{formatPrice(cartTotal)}</span>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any special instructions..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832] focus:border-[#5CB832]"
              />
            </div>
            <Button
              onClick={handleSubmit}
              loading={submitMutation.isPending}
              className="w-full bg-[#5CB832] hover:bg-[#4a9628]"
              size="lg"
            >
              Submit Order
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ============================================================
// Cart Panel Sub-component
// ============================================================

function CartPanel({
  cart,
  cartByCategory,
  cartCount,
  cartTotal,
  onUpdateQty,
  onRemove,
  onClear,
  onReview,
  embedded,
}: {
  cart: CartItem[];
  cartByCategory: Record<string, CartItem[]>;
  cartCount: number;
  cartTotal: number;
  onUpdateQty: (id: number, qty: number) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
  onReview: () => void;
  embedded?: boolean;
}) {
  if (cart.length === 0) {
    return (
      <div className={clsx(!embedded && 'sticky top-4')}>
        <Card>
          <div className="text-center py-6 text-gray-400">
            <ShoppingCart className="h-8 w-8 mx-auto mb-2" />
            <p className="text-sm">Cart is empty</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className={clsx(!embedded && 'sticky top-4')}>
      <Card padding={false}>
        {!embedded && (
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Cart
              <span className="text-xs bg-gray-100 rounded-full px-2 py-0.5 text-gray-600">
                {cartCount}
              </span>
            </h3>
            <button onClick={onClear} className="text-xs text-red-500 hover:text-red-700">
              Clear
            </button>
          </div>
        )}

        <div className="max-h-[50vh] overflow-y-auto divide-y divide-gray-100">
          {Object.entries(cartByCategory).map(([category, items]) => (
            <div key={category}>
              <div className="px-3 py-1.5 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                {category}
              </div>
              {items.map((item) => (
                <div key={item.supply_item_id} className="px-3 py-2 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{item.name}</p>
                    <p className="text-xs text-gray-500">
                      {formatPrice(item.price)} x {item.quantity} ={' '}
                      <span className="font-medium text-gray-700">
                        {formatPrice(item.price * item.quantity)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => onUpdateQty(item.supply_item_id, item.quantity - 1)}
                      className="h-6 w-6 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-6 text-center text-sm">{item.quantity}</span>
                    <button
                      onClick={() => onUpdateQty(item.supply_item_id, item.quantity + 1)}
                      className="h-6 w-6 flex items-center justify-center rounded border border-gray-300 text-gray-500 hover:bg-gray-100"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => onRemove(item.supply_item_id)}
                      className="h-6 w-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600">{cartCount} items</span>
            <span className="font-semibold text-gray-900">{formatPrice(cartTotal)}</span>
          </div>
          <Button onClick={onReview} className="w-full" size="sm">
            Review Order
          </Button>
          {embedded && (
            <button onClick={onClear} className="w-full text-xs text-red-500 hover:text-red-700 py-1">
              Clear Cart
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// Order History Sub-component
// ============================================================

function orderTotal(order: OrderRecord): number {
  return (order.items ?? []).reduce((sum, item) => sum + (item.item_price ?? 0) * item.quantity, 0);
}

function OrderHistoryView({
  orders,
  loading,
  allLocations,
  selectedOrder,
  onSelectOrder,
  isOwner,
  onDeleteOrder,
}: {
  orders: OrderRecord[];
  loading: boolean;
  allLocations: { id: number; name: string }[];
  selectedOrder: OrderRecord | null;
  onSelectOrder: (o: OrderRecord | null) => void;
  isOwner: boolean;
  onDeleteOrder: (id: number) => void;
  onUpdateStatus: (id: number, status: string) => void;
}) {
  const locationName = (id: number) => allLocations.find((l) => l.id === id)?.name ?? `Location ${id}`;

  if (loading) {
    return (
      <div className="py-12">
        <LoadingSpinner label="Loading orders..." />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <Card>
        <div className="text-center py-12 text-gray-400">
          <Package className="h-10 w-10 mx-auto mb-3" />
          <p>No orders yet</p>
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {orders.map((order) => (
          <Card key={order.id} padding={false} className="hover:shadow-md transition-shadow">
            <button
              onClick={() => onSelectOrder(order)}
              className="w-full text-left px-4 py-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">Order #{order.id}</span>
                  <Badge variant={statusBadgeVariant(order.status)}>
                    {order.status}
                  </Badge>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {locationName(order.location_id)} &middot;{' '}
                  {new Date(order.created_at).toLocaleDateString()} &middot;{' '}
                  {order.items?.length ?? 0} items
                  {` \u00b7 ${formatPrice(orderTotal(order))}`}
                </p>
                {order.orderer_name && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    placed by {order.orderer_name}
                  </p>
                )}
              </div>
              <ChevronRight className="h-5 w-5 text-gray-400 flex-shrink-0" />
            </button>
          </Card>
        ))}
      </div>

      {/* Order detail modal */}
      <Modal
        open={!!selectedOrder}
        onClose={() => onSelectOrder(null)}
        title={selectedOrder ? `Order #${selectedOrder.id}` : ''}
        size="lg"
      >
        {selectedOrder && (
          <div className="space-y-3">
            <div className="flex items-center flex-wrap gap-2 text-sm text-gray-600">
              <Badge variant={statusBadgeVariant(selectedOrder.status)}>
                {selectedOrder.status}
              </Badge>
              <span>{locationName(selectedOrder.location_id)}</span>
              <span>&middot;</span>
              <span>{new Date(selectedOrder.created_at).toLocaleString()}</span>
              {selectedOrder.orderer_name && (
                <>
                  <span>&middot;</span>
                  <span>placed by <strong>{selectedOrder.orderer_name}</strong></span>
                </>
              )}
            </div>

            {selectedOrder.notes && (
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-medium">Notes:</span> {selectedOrder.notes}
              </p>
            )}

            <div className="border rounded-lg divide-y divide-gray-100">
              {selectedOrder.items?.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-gray-900">{item.item_name ?? `Item #${item.supply_item_id}`}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">x{item.quantity}</span>
                    {item.item_price != null && (
                      <span className="font-medium text-gray-700">
                        {formatPrice(item.item_price * item.quantity)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center pt-2 border-t">
              <span className="font-semibold">Total</span>
              <span className="text-lg font-bold text-[#5CB832]">
                {formatPrice(orderTotal(selectedOrder))}
              </span>
            </div>

            {isOwner && (
              <div className="flex items-center gap-2 pt-2 border-t flex-wrap">
                {selectedOrder.status === 'pending' && (
                  <Button
                    size="sm"
                    onClick={() => onUpdateStatus(selectedOrder.id, 'confirmed')}
                  >
                    Confirm Order
                  </Button>
                )}
                {(selectedOrder.status === 'pending' || selectedOrder.status === 'confirmed') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onUpdateStatus(selectedOrder.id, 'delivered')}
                  >
                    Mark Delivered
                  </Button>
                )}
                <button
                  onClick={() => onDeleteOrder(selectedOrder.id)}
                  className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 ml-auto"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}


// ============================================================
// CatalogUnitFields — pack size / unit / count / density inputs
// ============================================================

type CatalogUnitFormState = {
  pack_size: string;
  pack_unit: string;
  is_count_item: boolean;
  density_oz_per_cup: string;
  price: string;
  [k: string]: any;
};

function CatalogSupplierFields({
  itemForm,
  setItemForm,
}: {
  itemForm: { supplier: string; usfoods_pn: string; [k: string]: any };
  setItemForm: React.Dispatch<React.SetStateAction<any>>;
}) {
  const isUSFoods = itemForm.supplier === 'US FOODS';
  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3 bg-gray-50">
      <p className="text-xs uppercase text-gray-500">Supplier</p>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Order this from
        </label>
        <select
          value={itemForm.supplier}
          onChange={(e) => setItemForm((f: any) => ({ ...f, supplier: e.target.value }))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832]"
        >
          {SUPPLIER_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Tells the Mon/Fri 9 AM supply report which list this item belongs on when it's ordered through the portal.
        </p>
      </div>
      {isUSFoods && (
        <Input
          label="US Foods product # (PN)"
          value={itemForm.usfoods_pn}
          onChange={(e) => setItemForm((f: any) => ({ ...f, usfoods_pn: e.target.value }))}
          placeholder="e.g. 1234567"
          helperText="7-digit number from your US Foods catalog. Required for the Monday US Foods cron to include portal-placed orders."
        />
      )}
    </div>
  );
}

function CatalogUnitFields({
  itemForm,
  setItemForm,
}: {
  itemForm: CatalogUnitFormState;
  setItemForm: React.Dispatch<React.SetStateAction<any>>;
}) {
  // Live cost-per-base-unit preview using simple front-end conversion.
  const preview = (() => {
    const price = parseFloat(itemForm.price);
    const size = parseFloat(itemForm.pack_size);
    if (!Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return null;
    const u = (itemForm.pack_unit || '').toLowerCase();
    if (!u) return null;
    const toBase: Record<string, [string, number]> = {
      oz: ['oz', 1], lb: ['oz', 16], g: ['oz', 0.035274], kg: ['oz', 35.274],
      floz: ['floz', 1], cup: ['floz', 8], tbsp: ['floz', 0.5], tsp: ['floz', 0.16667],
      gal: ['floz', 128], qt: ['floz', 32], pt: ['floz', 16],
      ml: ['floz', 0.033814], l: ['floz', 33.814],
      each: ['each', 1],
    };
    const c = toBase[u];
    if (!c) return null;
    const baseAmount = size * c[1];
    if (baseAmount <= 0) return null;
    return { unit: c[0], cost: price / baseAmount };
  })();

  return (
    <div className="space-y-3 rounded-md border border-gray-200 p-3 bg-gray-50">
      <p className="text-xs uppercase text-gray-500">Recipe costing (optional)</p>
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Pack size"
          type="number"
          step="0.01"
          value={itemForm.pack_size}
          onChange={(e) => setItemForm((f: any) => ({ ...f, pack_size: e.target.value }))}
          placeholder="e.g. 128"
        />
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
          <select
            value={itemForm.pack_unit}
            onChange={(e) => {
              const u = e.target.value;
              setItemForm((f: any) => ({
                ...f,
                pack_unit: u,
                is_count_item: u === 'each' ? true : f.is_count_item && u !== '' ? false : f.is_count_item,
              }));
            }}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#5CB832]"
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={itemForm.is_count_item}
          onChange={(e) => setItemForm((f: any) => ({ ...f, is_count_item: e.target.checked }))}
        />
        <span>Count item (eggs, bagels, lids — recipes use whole units)</span>
      </label>
      {(itemForm.pack_unit === 'cup' || itemForm.pack_unit === 'tbsp' || itemForm.pack_unit === 'tsp') && (
        <Input
          label="Density (oz of weight per 1 cup) — optional, lets recipes mix volume + weight"
          type="number"
          step="0.01"
          value={itemForm.density_oz_per_cup}
          onChange={(e) => setItemForm((f: any) => ({ ...f, density_oz_per_cup: e.target.value }))}
          placeholder="e.g. 4.25 for flour"
        />
      )}
      {preview && (
        <p className="text-sm text-gray-700">
          Per-unit cost: <strong>${preview.cost.toFixed(4)}</strong> / {preview.unit}
        </p>
      )}
    </div>
  );
}
