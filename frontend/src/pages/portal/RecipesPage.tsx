import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChefHat,
  Plus,
  Pencil,
  Trash2,
  Copy,
  Tag,
  Beaker,
  Layers,
  X as XIcon,
  Upload as UploadIcon,
  Receipt as ReceiptIcon,
  Link as LinkIcon,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';

import { recipes, posSales, locations as locationsApi } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';

const UNIT_OPTIONS = [
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
  { value: 'each', label: 'each' },
];

const SIZE_OPTIONS = [
  { value: '', label: 'All sizes (no variant)' },
  { value: 'KIDS', label: 'Kids' },
  { value: 'S', label: 'Small' },
  { value: 'M', label: 'Medium' },
  { value: 'L', label: 'Large' },
  { value: 'XL', label: 'Extra Large' },
];

type Tab = 'recipes' | 'templates' | 'categories' | 'sales';

interface RecipeCategory {
  id: number;
  name: string;
  sort_order: number;
  is_archived: boolean;
}

interface RecipeSummary {
  id: number;
  name: string;
  sku: string | null;
  category_id: number;
  category_name: string | null;
  is_template: boolean;
  is_active: boolean;
  yields_amount: number | null;
  yields_unit: string | null;
  base_size: string | null;
  notes: string | null;
}

interface RecipeIngredientRow {
  id?: number;
  supply_item_id: number | null;
  sub_recipe_id: number | null;
  amount: number;
  unit: string;
  size_variant: string | null;
  sort_order: number;
  notes: string | null;
  label: string;
  kind: 'supply' | 'sub_recipe';
}

interface CostLine {
  label: string;
  kind: string;
  source_id: number;
  amount: number;
  unit: string;
  size_variant: string | null;
  cost: number;
  error: string | null;
}

interface RecipeDetail extends RecipeSummary {
  current_version_id: number | null;
  version_count: number;
  ingredients: RecipeIngredientRow[];
  cost: {
    by_size: Record<string, number>;
    lines: CostLine[];
    cost_per_yield_unit: number | null;
    error?: string;
  };
}

interface IngredientOption {
  id: number;
  name: string;
  category?: string;
  pack_size?: number | null;
  pack_unit?: string | null;
  is_count_item?: boolean;
  cost_per_base_unit?: number | null;
  base_unit?: string | null;
  needs_costing?: boolean;
  yields_amount?: number | null;
  yields_unit?: string | null;
}

const money = (v: number | null | undefined) => {
  if (v == null) return '—';
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
};

export function RecipesPage() {
  const [tab, setTab] = useState<Tab>('recipes');

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'recipes', label: 'Recipes', icon: <ChefHat className="h-4 w-4" /> },
    { key: 'templates', label: 'Templates', icon: <Layers className="h-4 w-4" /> },
    { key: 'categories', label: 'Categories', icon: <Tag className="h-4 w-4" /> },
    { key: 'sales', label: 'POS Sales', icon: <ReceiptIcon className="h-4 w-4" /> },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Recipes</h1>
          <p className="page-subtitle">Build recipes, cost them from the catalog, and feed margin reports.</p>
        </div>
      </div>

      <Card className="mb-6 !p-2">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={clsx(
                'flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors',
                tab === t.key ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </Card>

      {tab === 'recipes' && <RecipeListTab onlyTemplates={false} />}
      {tab === 'templates' && <RecipeListTab onlyTemplates={true} />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'sales' && <PosSalesTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recipe list + new/edit
// ---------------------------------------------------------------------------

function RecipeListTab({ onlyTemplates }: { onlyTemplates: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [editorRecipeId, setEditorRecipeId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: cats } = useQuery<{ items: RecipeCategory[] }>({
    queryKey: ['recipe-categories'],
    queryFn: () => recipes.categories(false),
  });

  const params = useMemo(() => {
    const p: any = {};
    if (categoryId) p.category_id = Number(categoryId);
    if (onlyTemplates) p.is_template = true;
    if (search) p.search = search;
    return p;
  }, [categoryId, onlyTemplates, search]);

  const { data, isLoading } = useQuery<{ items: RecipeSummary[] }>({
    queryKey: ['recipes', params],
    queryFn: () => recipes.list(params),
  });

  const archive = useMutation({
    mutationFn: (id: number) => recipes.archive(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      toast.success('Recipe archived');
    },
    onError: () => toast.error('Archive failed'),
  });

  const duplicate = useMutation({
    mutationFn: (id: number) => recipes.duplicate(id),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      toast.success('Recipe duplicated');
      setEditorRecipeId(resp.id);
    },
    onError: () => toast.error('Duplicate failed'),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <Input placeholder="Search recipes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select
            className="w-56"
            options={[
              { value: '', label: 'All categories' },
              ...((cats?.items ?? []).map((c) => ({ value: String(c.id), label: c.name }))),
            ]}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          />
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
            New {onlyTemplates ? 'template' : 'recipe'}
          </Button>
        </div>
      </Card>

      <Card title={`${onlyTemplates ? 'Templates' : 'Recipes'}${data?.items ? ` · ${data.items.length}` : ''}`} className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6"><LoadingSpinner size="sm" /></div>
        ) : items.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-500">
            {onlyTemplates ? 'No templates yet.' : 'No recipes yet — start with + New recipe.'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">SKU</th>
                  <th className="px-3 py-2 text-left">Yields</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-medium">
                      <button onClick={() => setEditorRecipeId(r.id)} className="hover:text-primary text-left">
                        {r.name}
                      </button>
                      {r.is_template && <Badge variant="info" className="ml-2">template</Badge>}
                    </td>
                    <td className="px-3 py-2 text-gray-600">{r.category_name ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono text-xs">{r.sku ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {r.yields_amount && r.yields_unit ? `${r.yields_amount} ${r.yields_unit}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditorRecipeId(r.id)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" icon={<Copy className="h-4 w-4" />} onClick={() => duplicate.mutate(r.id)}>
                          Duplicate
                        </Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => {
                          if (confirm(`Archive "${r.name}"? It can be restored later by including archived in the filter.`)) {
                            archive.mutate(r.id);
                          }
                        }}>
                          Archive
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RecipeCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); setEditorRecipeId(id); }}
        categories={cats?.items ?? []}
        defaultIsTemplate={onlyTemplates}
      />

      {editorRecipeId !== null && (
        <RecipeEditorModal
          recipeId={editorRecipeId}
          categories={cats?.items ?? []}
          onClose={() => setEditorRecipeId(null)}
        />
      )}
    </div>
  );
}

function RecipeCreateModal({
  open,
  onClose,
  onCreated,
  categories,
  defaultIsTemplate,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
  categories: RecipeCategory[];
  defaultIsTemplate: boolean;
}) {
  const [form, setForm] = useState({
    name: '',
    category_id: '',
    sku: '',
    is_template: defaultIsTemplate,
    yields_amount: '',
    yields_unit: '',
    template_id: '',
  });

  useEffect(() => {
    if (!open) return;
    setForm({
      name: '',
      category_id: categories[0] ? String(categories[0].id) : '',
      sku: '',
      is_template: defaultIsTemplate,
      yields_amount: '',
      yields_unit: '',
      template_id: '',
    });
  }, [open, defaultIsTemplate, categories]);

  const { data: templates } = useQuery<{ items: RecipeSummary[] }>({
    queryKey: ['recipes', 'templates-only'],
    queryFn: () => recipes.list({ is_template: true }),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => recipes.create({
      name: form.name.trim(),
      category_id: Number(form.category_id),
      sku: form.sku.trim() || null,
      is_template: form.is_template,
      yields_amount: form.yields_amount ? parseFloat(form.yields_amount) : null,
      yields_unit: form.yields_unit || null,
      template_id: form.template_id ? Number(form.template_id) : null,
    }),
    onSuccess: (resp) => {
      toast.success('Recipe created');
      onCreated(resp.id);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Create failed'),
  });

  return (
    <Modal open={open} onClose={onClose} title="New recipe">
      <div className="space-y-3">
        <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Vanilla Latte" />
        <Select
          label="Category"
          options={[{ value: '', label: 'Pick…' }, ...categories.map((c) => ({ value: String(c.id), label: c.name }))]}
          value={form.category_id}
          onChange={(e) => setForm({ ...form, category_id: e.target.value })}
        />
        <Input label="GoDaddy SKU (optional)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="e.g. FLVRD-LTT-0" />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Yields amount (optional — for sub-recipes)" type="number" step="0.01" value={form.yields_amount} onChange={(e) => setForm({ ...form, yields_amount: e.target.value })} placeholder="e.g. 64" />
          <Select
            label="Yield unit"
            options={[{ value: '', label: '—' }, ...UNIT_OPTIONS]}
            value={form.yields_unit}
            onChange={(e) => setForm({ ...form, yields_unit: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.is_template} onChange={(e) => setForm({ ...form, is_template: e.target.checked })} />
          <span>Save as template</span>
        </label>
        {(templates?.items?.length ?? 0) > 0 && (
          <Select
            label="Start from template (optional)"
            options={[{ value: '', label: 'Empty recipe' }, ...(templates?.items ?? []).map((t) => ({ value: String(t.id), label: t.name }))]}
            value={form.template_id}
            onChange={(e) => setForm({ ...form, template_id: e.target.value })}
          />
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name.trim() || !form.category_id}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RecipeEditorModal({
  recipeId,
  categories,
  onClose,
}: {
  recipeId: number;
  categories: RecipeCategory[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useQuery<RecipeDetail>({
    queryKey: ['recipe', recipeId],
    queryFn: () => recipes.get(recipeId),
  });

  const [meta, setMeta] = useState({
    name: '', category_id: '', sku: '', is_template: false,
    yields_amount: '', yields_unit: '', notes: '',
  });
  const [lines, setLines] = useState<RecipeIngredientRow[]>([]);

  useEffect(() => {
    if (!data) return;
    setMeta({
      name: data.name,
      category_id: String(data.category_id),
      sku: data.sku ?? '',
      is_template: data.is_template,
      yields_amount: data.yields_amount != null ? String(data.yields_amount) : '',
      yields_unit: data.yields_unit ?? '',
      notes: data.notes ?? '',
    });
    setLines(data.ingredients ?? []);
  }, [data]);

  const saveMeta = useMutation({
    mutationFn: () => recipes.updateMeta(recipeId, {
      name: meta.name.trim(),
      category_id: Number(meta.category_id),
      sku: meta.sku.trim() || null,
      is_template: meta.is_template,
      yields_amount: meta.yields_amount ? parseFloat(meta.yields_amount) : null,
      yields_unit: meta.yields_unit || null,
      notes: meta.notes.trim() || null,
    }),
    onSuccess: () => {
      toast.success('Saved');
      queryClient.invalidateQueries({ queryKey: ['recipes'] });
      queryClient.invalidateQueries({ queryKey: ['recipe', recipeId] });
    },
    onError: () => toast.error('Save failed'),
  });

  const saveIngredients = useMutation({
    mutationFn: () => recipes.replaceIngredients(recipeId, lines.map((l, i) => ({
      supply_item_id: l.supply_item_id,
      sub_recipe_id: l.sub_recipe_id,
      amount: l.amount,
      unit: l.unit,
      size_variant: l.size_variant || null,
      sort_order: i,
      notes: l.notes,
    }))),
    onSuccess: () => {
      toast.success('Ingredients saved');
      refetch();
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Save failed'),
  });

  return (
    <Modal open={true} onClose={onClose} title={data?.name ?? 'Recipe'} size="lg">
      {isLoading || !data ? (
        <div className="p-6"><LoadingSpinner size="sm" /></div>
      ) : (
        <div className="space-y-6">
          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3">
            <Input label="Name" value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} />
            <Select
              label="Category"
              options={categories.map((c) => ({ value: String(c.id), label: c.name }))}
              value={meta.category_id}
              onChange={(e) => setMeta({ ...meta, category_id: e.target.value })}
            />
            <Input label="GoDaddy SKU" value={meta.sku} onChange={(e) => setMeta({ ...meta, sku: e.target.value })} placeholder="e.g. FLVRD-LTT-0" />
            <label className="flex items-center gap-2 text-sm pt-6">
              <input type="checkbox" checked={meta.is_template} onChange={(e) => setMeta({ ...meta, is_template: e.target.checked })} />
              <span>Template</span>
            </label>
            <Input label="Yields amount" type="number" step="0.01" value={meta.yields_amount} onChange={(e) => setMeta({ ...meta, yields_amount: e.target.value })} placeholder="e.g. 64" />
            <Select
              label="Yield unit"
              options={[{ value: '', label: '—' }, ...UNIT_OPTIONS]}
              value={meta.yields_unit}
              onChange={(e) => setMeta({ ...meta, yields_unit: e.target.value })}
            />
          </div>
          <Input label="Notes" value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
          <div className="flex justify-end">
            <Button size="sm" onClick={() => saveMeta.mutate()} loading={saveMeta.isPending}>Save metadata</Button>
          </div>

          <hr />

          {/* Ingredients */}
          <IngredientEditor lines={lines} setLines={setLines} selfRecipeId={recipeId} />

          <div className="flex justify-end">
            <Button onClick={() => saveIngredients.mutate()} loading={saveIngredients.isPending}>
              Save ingredients
            </Button>
          </div>

          {/* Cost summary */}
          <CostSummary cost={data.cost} />
        </div>
      )}
    </Modal>
  );
}

function IngredientEditor({
  lines,
  setLines,
  selfRecipeId,
}: {
  lines: RecipeIngredientRow[];
  setLines: (next: RecipeIngredientRow[]) => void;
  selfRecipeId: number;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const update = (idx: number, patch: Partial<RecipeIngredientRow>) => {
    const next = [...lines];
    next[idx] = { ...next[idx], ...patch };
    setLines(next);
  };
  const remove = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Ingredients</h3>
        <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setPickerOpen(true)}>
          Add ingredient
        </Button>
      </div>

      {lines.length === 0 ? (
        <p className="text-sm text-gray-500 py-4 text-center border border-dashed border-gray-200 rounded">
          No ingredients yet — click + Add ingredient.
        </p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Source</th>
                <th className="px-3 py-2 text-left">Amount</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">Size variant</th>
                <th className="px-3 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className="px-3 py-2">
                    <span className="text-sm">{l.label}</span>
                    {l.kind === 'sub_recipe' && <Badge variant="info" className="ml-2">sub-recipe</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      value={l.amount}
                      onChange={(e) => update(idx, { amount: parseFloat(e.target.value) || 0 })}
                      className="w-24 border border-gray-200 rounded px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={l.unit}
                      onChange={(e) => update(idx, { unit: e.target.value })}
                      className="border border-gray-200 rounded px-2 py-1 text-sm"
                    >
                      {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={l.size_variant ?? ''}
                      onChange={(e) => update(idx, { size_variant: e.target.value || null })}
                      className="border border-gray-200 rounded px-2 py-1 text-sm"
                    >
                      {SIZE_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => remove(idx)} className="text-gray-400 hover:text-red-500">
                      <XIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <IngredientPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        excludeRecipeId={selfRecipeId}
        onPick={(opt, kind) => {
          const newLine: RecipeIngredientRow = {
            supply_item_id: kind === 'supply' ? opt.id : null,
            sub_recipe_id: kind === 'sub_recipe' ? opt.id : null,
            amount: 1,
            unit: kind === 'sub_recipe' ? (opt.yields_unit ?? 'oz') : (opt.is_count_item ? 'each' : (opt.base_unit ?? 'oz')),
            size_variant: null,
            sort_order: lines.length,
            notes: null,
            label: opt.name,
            kind,
          };
          setLines([...lines, newLine]);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function IngredientPickerModal({
  open,
  onClose,
  onPick,
  excludeRecipeId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (opt: IngredientOption, kind: 'supply' | 'sub_recipe') => void;
  excludeRecipeId: number;
}) {
  const [search, setSearch] = useState('');
  const { data } = useQuery<{ supply_items: IngredientOption[]; sub_recipes: IngredientOption[] }>({
    queryKey: ['ingredient-options', search],
    queryFn: () => recipes.ingredientOptions(search || undefined),
    enabled: open,
  });

  const supplyItems = data?.supply_items ?? [];
  const subRecipes = (data?.sub_recipes ?? []).filter((r) => r.id !== excludeRecipeId);

  return (
    <Modal open={open} onClose={onClose} title="Pick ingredient" size="lg">
      <div className="space-y-4">
        <Input placeholder="Search ingredients or sub-recipes…" value={search} onChange={(e) => setSearch(e.target.value)} />

        {subRecipes.length > 0 && (
          <div>
            <p className="text-xs uppercase text-gray-500 mb-2 flex items-center gap-1">
              <Beaker className="h-3 w-3" /> Sub-recipes (house-made)
            </p>
            <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-48 overflow-y-auto">
              {subRecipes.map((r) => (
                <button
                  key={`sub-${r.id}`}
                  onClick={() => onPick(r, 'sub_recipe')}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex justify-between items-center"
                >
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="text-xs text-gray-500">yields {r.yields_amount} {r.yields_unit}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="text-xs uppercase text-gray-500 mb-2">Catalog</p>
          {supplyItems.length === 0 ? (
            <p className="text-sm text-gray-500 py-4 text-center">No matching catalog items.</p>
          ) : (
            <div className="border border-gray-200 rounded divide-y divide-gray-100 max-h-96 overflow-y-auto">
              {supplyItems.map((i) => (
                <button
                  key={`sup-${i.id}`}
                  onClick={() => onPick(i, 'supply')}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 flex justify-between items-center"
                >
                  <div>
                    <p className="text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-gray-500">
                      {i.category}
                      {i.pack_size && i.pack_unit && <> · {i.pack_size} {i.pack_unit}</>}
                      {i.cost_per_base_unit != null && <> · ${i.cost_per_base_unit.toFixed(4)}/{i.base_unit}</>}
                    </p>
                  </div>
                  {i.needs_costing && <Badge variant="pending">needs costing</Badge>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function CostSummary({ cost }: { cost: RecipeDetail['cost'] }) {
  if (cost.error) {
    return (
      <div className="border border-red-200 bg-red-50 rounded p-3 text-sm text-red-700">
        Costing error: {cost.error}
      </div>
    );
  }
  const sizeKeys = Object.keys(cost.by_size);
  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">Cost breakdown</h3>
      {sizeKeys.length === 0 ? (
        <p className="text-sm text-gray-500">No costable ingredients yet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {sizeKeys.map((k) => (
              <div key={k} className="border border-gray-200 rounded p-2 text-center">
                <p className="text-xs text-gray-500 uppercase">{k}</p>
                <p className="font-semibold tabular-nums">${cost.by_size[k].toFixed(4)}</p>
              </div>
            ))}
          </div>
          {cost.cost_per_yield_unit != null && (
            <p className="text-sm text-emerald-700 mb-3">
              Sub-recipe yield: <strong>${cost.cost_per_yield_unit.toFixed(4)}</strong> per yield unit
            </p>
          )}
          <div className="border border-gray-200 rounded">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-1.5 text-left">Ingredient</th>
                  <th className="px-3 py-1.5 text-left">Amount</th>
                  <th className="px-3 py-1.5 text-left">Size</th>
                  <th className="px-3 py-1.5 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {cost.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5">{l.label}{l.kind === 'sub_recipe' && <span className="text-gray-400"> (sub)</span>}</td>
                    <td className="px-3 py-1.5">{l.amount} {l.unit}</td>
                    <td className="px-3 py-1.5">{l.size_variant ?? 'all'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {l.error ? <span className="text-red-500">{l.error}</span> : `$${l.cost.toFixed(4)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Categories tab
// ---------------------------------------------------------------------------

function CategoriesTab() {
  const queryClient = useQueryClient();
  const { data } = useQuery<{ items: RecipeCategory[] }>({
    queryKey: ['recipe-categories', 'all'],
    queryFn: () => recipes.categories(true),
  });

  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<RecipeCategory | null>(null);
  const [editName, setEditName] = useState('');

  const create = useMutation({
    mutationFn: () => recipes.createCategory({ name: newName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe-categories'] });
      setNewName('');
      toast.success('Category added');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Add failed'),
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => recipes.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe-categories'] });
      setEditing(null);
      toast.success('Saved');
    },
    onError: () => toast.error('Save failed'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => recipes.deleteCategory(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recipe-categories'] });
      toast.success('Category removed');
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Delete failed'),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Input label="Add category" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Seasonal Drinks" />
          </div>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!newName.trim()}>
            Add
          </Button>
        </div>
      </Card>

      <Card title={`Categories · ${items.length}`} className="!p-0 overflow-hidden">
        {items.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 text-center">No categories.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{c.name}</span>
                  {c.is_archived && <Badge variant="pending">archived</Badge>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={<Pencil className="h-4 w-4" />} onClick={() => { setEditing(c); setEditName(c.name); }}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, data: { is_archived: !c.is_archived } })}>
                    {c.is_archived ? 'Restore' : 'Archive'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => {
                    if (confirm(`Delete "${c.name}"? Recipes using it must be reassigned first.`)) remove.mutate(c.id);
                  }}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Rename "${editing?.name}"`}>
        <div className="space-y-3">
          <Input label="Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && update.mutate({ id: editing.id, data: { name: editName.trim() } })} disabled={!editName.trim()}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS Sales tab
// ---------------------------------------------------------------------------

interface PosSaleRow {
  id: number;
  sale_datetime: string;
  transaction_id: string;
  order_id: string | null;
  sku: string | null;
  item_name: string;
  modifiers: Array<{ group: string; value: string }>;
  unit_price: number;
  quantity: number;
  subtotal: number;
  item_discount: number;
  grand_total: number;
  status: string | null;
  location_id: number | null;
  location_name: string | null;
  linked_recipe_id: number | null;
  linked_recipe_name: string | null;
}

function PosSalesTab() {
  const queryClient = useQueryClient();
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [start, setStart] = useState(fmt(sevenDaysAgo));
  const [end, setEnd] = useState(fmt(today));
  const [locationId, setLocationId] = useState<string>('');
  const [skuFilter, setSkuFilter] = useState('');
  const [page, setPage] = useState(1);

  const { data: locs } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['locations'],
    queryFn: locationsApi.list,
  });

  const params = useMemo(() => {
    const p: any = { start_date: start, end_date: end, page, per_page: 100 };
    if (locationId) p.location_id = Number(locationId);
    if (skuFilter) p.sku = skuFilter;
    return p;
  }, [start, end, locationId, skuFilter, page]);

  const statsParams = useMemo(() => {
    const p: any = { start_date: start, end_date: end };
    if (locationId) p.location_id = Number(locationId);
    return p;
  }, [start, end, locationId]);

  const { data: stats } = useQuery({
    queryKey: ['pos-sales-stats', statsParams],
    queryFn: () => posSales.stats(statsParams),
  });

  const { data, isLoading } = useQuery<{ items: PosSaleRow[]; total: number }>({
    queryKey: ['pos-sales', params],
    queryFn: () => posSales.list(params),
  });

  const upload = useMutation({
    mutationFn: ({ file, locId }: { file: File; locId: number }) =>
      posSales.uploadItemsXlsx(file, locId),
    onSuccess: (resp) => {
      queryClient.invalidateQueries({ queryKey: ['pos-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-sales-stats'] });
      toast.success(`Imported ${resp.inserted} new line(s) - skipped ${resp.skipped_duplicate} duplicate(s)`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.detail ?? 'Upload failed'),
  });

  const handleFile = (file: File) => {
    if (!locationId) {
      toast.error('Pick a location before uploading');
      return;
    }
    upload.mutate({ file, locId: Number(locationId) });
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <Input label="Start date" type="date" value={start} onChange={(e) => { setPage(1); setStart(e.target.value); }} />
          <Input label="End date" type="date" value={end} onChange={(e) => { setPage(1); setEnd(e.target.value); }} />
          <Select
            label="Location"
            className="w-56"
            options={[{ value: '', label: 'All locations' }, ...((locs ?? []).map((l) => ({ value: String(l.id), label: l.name })))]}
            value={locationId}
            onChange={(e) => { setPage(1); setLocationId(e.target.value); }}
          />
          <Input label="SKU" value={skuFilter} onChange={(e) => { setPage(1); setSkuFilter(e.target.value); }} placeholder="e.g. FLVRD-LTT-0" />
          <div className="ml-auto flex items-end gap-2">
            <label className="cursor-pointer inline-flex">
              <input
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.currentTarget.value = '';
                }}
              />
              <span className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-primary text-white shadow-sm cursor-pointer hover:opacity-90">
                <UploadIcon className="h-4 w-4" />
                {upload.isPending ? 'Uploading...' : 'Upload Items XLSX'}
              </span>
            </label>
          </div>
        </div>
        {!locationId && (
          <p className="text-xs text-amber-700 mt-2 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Pick a location before uploading - the GoDaddy export does not carry one.
          </p>
        )}
      </Card>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <p className="text-xs uppercase text-gray-500">Lines</p>
            <p className="text-2xl font-semibold tabular-nums">{stats.rows.toLocaleString()}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-gray-500">Gross subtotal</p>
            <p className="text-2xl font-semibold tabular-nums">${stats.gross_subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-gray-500">Distinct SKUs</p>
            <p className="text-2xl font-semibold tabular-nums">{stats.distinct_skus}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-gray-500">Recipe coverage</p>
            <p className="text-2xl font-semibold tabular-nums">
              {stats.linked_skus} / {stats.distinct_skus}
            </p>
            <p className="text-xs text-gray-500">{stats.unlinked_skus} unlinked</p>
          </Card>
        </div>
      )}

      {stats?.top_skus?.length > 0 && (
        <Card title="Top SKUs by quantity (this window)" className="!p-0 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Lines</th>
                <th className="px-3 py-2 text-right">Gross</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {stats.top_skus.map((s: any) => (
                <tr key={s.sku}>
                  <td className="px-3 py-1.5 font-mono text-xs">{s.sku}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.qty}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.lines}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">${s.gross.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title={`Sales - ${data?.total ?? 0}`} className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6"><LoadingSpinner size="sm" /></div>
        ) : !data?.items?.length ? (
          <p className="p-8 text-center text-sm text-gray-500">No POS sales in this window - upload an Items XLSX to start.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Item</th>
                  <th className="px-3 py-2 text-left">Modifiers</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-left">Recipe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.items.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(s.sale_datetime).toLocaleString(undefined, {
                        month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.item_name}</div>
                      {s.sku && <div className="text-xs text-gray-400 font-mono">{s.sku}</div>}
                    </td>
                    <td className="px-3 py-2">
                      {s.modifiers.length === 0 ? (
                        <span className="text-xs text-gray-300">-</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.modifiers.map((m, i) => (
                            <span key={i} className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                              <span className="text-gray-500">{m.group}:</span> {m.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.quantity}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${s.unit_price.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {s.linked_recipe_id ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <LinkIcon className="h-3 w-3" /> {s.linked_recipe_name}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">no recipe</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data?.total != null && data.total > 100 && (
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-sm text-gray-600 self-center">
            Page {page} of {Math.ceil(data.total / 100)}
          </span>
          <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page * 100 >= data.total}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
