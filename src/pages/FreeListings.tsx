import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  ArrowLeft,
  Download,
  Loader2,
  Search,
  ShieldAlert,
  Users,
} from 'lucide-react';

/**
 * Admin "Free Listings" follow-up list.
 *
 * Reads the `free_listings` collection — the durable lead-of-record written for
 * every applicant who reaches the onboarding Agreement stage (see
 * freeListingsService.captureFreeListing). This is the list the client asked to
 * have "saved to follow up": everyone who completed the agreement and was
 * promised a free listing, whether or not they went on to pay for an upgrade.
 */
interface FreeListingDoc {
  id: string;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  city: string;
  state: string;
  zipCode: string;
  ptin: string;
  efin: string;
  yearsPreparing: string;
  agreementVersion: string;
  signedAt: string;
  status: string;
  upgraded: boolean;
  upgradedTier: string;
  firebaseUid: string | null;
}

function tsToDate(t: any): Date | null {
  if (!t) return null;
  if (t instanceof Timestamp) return t.toDate();
  if (typeof t === 'string') {
    const d = new Date(t);
    return isNaN(d.getTime()) ? null : d;
  }
  if (t?.seconds) return new Date(t.seconds * 1000);
  return null;
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleString();
  } catch {
    return '—';
  }
}

/** Build and download a CSV of the (filtered) leads for offline follow-up. */
function exportCsv(rows: FreeListingDoc[]) {
  const headers = [
    'Name',
    'Email',
    'Phone',
    'Business',
    'City',
    'State',
    'Zip',
    'PTIN',
    'EFIN',
    'Years Preparing',
    'Signed At',
    'Status',
    'Upgraded Tier',
  ];
  const escapeCell = (v: string) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.name,
      r.email,
      r.phone,
      r.businessName,
      r.city,
      r.state,
      r.zipCode,
      r.ptin,
      r.efin,
      r.yearsPreparing,
      fmt(tsToDate(r.signedAt)),
      r.upgraded ? 'Upgraded' : 'Free listing',
      r.upgradedTier,
    ]
      .map(escapeCell)
      .join(','),
  );
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `free-listings-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function FreeListings() {
  const { user, loading, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [items, setItems] = useState<FreeListingDoc[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate('/');
  }, [user, loading, navigate]);

  useEffect(() => {
    if (!isAdmin) return;
    setListLoading(true);
    setLoadError(null);

    const q = query(collection(db, 'free_listings'), orderBy('signed_at', 'desc'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows: FreeListingDoc[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: data.name || '—',
            email: data.email_original || data.email || '—',
            phone: data.phone || '',
            businessName: data.business_name || '',
            city: data.city || '',
            state: data.state || '',
            zipCode: data.zip_code || '',
            ptin: data.ptin || '',
            efin: data.efin || '',
            yearsPreparing: data.years_preparing || '',
            agreementVersion: data.agreement_version || '',
            signedAt: data.signed_at || '',
            status: data.status || 'free_listing',
            upgraded: !!data.upgraded,
            upgradedTier: data.upgraded_tier || '',
            firebaseUid: data.firebase_uid || null,
          };
        });
        setItems(rows);
        setListLoading(false);
      },
      (err) => {
        console.error('Failed to load free_listings:', err);
        setLoadError(err?.message || 'Could not load free listings.');
        setListLoading(false);
      },
    );
    return () => unsub();
  }, [isAdmin]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((a) =>
      [a.name, a.email, a.phone, a.businessName, a.city, a.state, a.ptin]
        .join(' ')
        .toLowerCase()
        .includes(s),
    );
  }, [items, search]);

  const upgradedCount = useMemo(
    () => items.filter((i) => i.upgraded).length,
    [items],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) return null;

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Alert variant="destructive" className="max-w-md">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Access Denied</AlertTitle>
          <AlertDescription>
            You do not have permission to view free listings. This page is
            restricted to administrators.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="p-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/admin"
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
          </Link>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <Users className="h-7 w-7 text-blue-600" />
                Free Listings
                <Badge variant="secondary" className="text-sm">
                  {items.length}
                </Badge>
              </h1>
              <p className="text-gray-600 mt-1">
                Everyone who completed the onboarding Agreement stage and was
                saved for their free listing — {upgradedCount} of {items.length}{' '}
                went on to upgrade. Use this list to follow up.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => exportCsv(filtered)}
              disabled={filtered.length === 0}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4 max-w-md">
          <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
          <Input
            placeholder="Search name, email, phone, business, PTIN…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Body */}
        {loadError ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load free listings</AlertTitle>
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
        ) : listLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <Users className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500">
                {items.length === 0
                  ? 'No free listings yet. Each applicant who signs the onboarding agreement will appear here automatically.'
                  : 'No listings match your search.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr className="text-left text-gray-700">
                    <th className="px-4 py-3 font-semibold">Name</th>
                    <th className="px-4 py-3 font-semibold">Email</th>
                    <th className="px-4 py-3 font-semibold">Phone</th>
                    <th className="px-4 py-3 font-semibold">Business</th>
                    <th className="px-4 py-3 font-semibold">Location</th>
                    <th className="px-4 py-3 font-semibold">PTIN</th>
                    <th className="px-4 py-3 font-semibold">Signed At</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const loc = [a.city, a.state].filter(Boolean).join(', ');
                    return (
                      <tr
                        key={a.id}
                        className="border-b last:border-0 hover:bg-blue-50 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {a.name}
                        </td>
                        <td className="px-4 py-3 text-gray-700">{a.email}</td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {a.phone || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {a.businessName || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {loc || '—'}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {a.ptin || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                          {fmt(tsToDate(a.signedAt))}
                        </td>
                        <td className="px-4 py-3">
                          {a.upgraded ? (
                            <Badge className="bg-green-100 text-green-800">
                              Upgraded{a.upgradedTier ? ` · ${a.upgradedTier}` : ''}
                            </Badge>
                          ) : (
                            <Badge variant="outline">Free listing</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
