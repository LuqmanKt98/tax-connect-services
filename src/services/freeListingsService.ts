import { db } from '@/lib/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * freeListingsService — guaranteed lead capture at the Agreement stage.
 *
 * WHY THIS EXISTS
 * ---------------
 * The onboarding funnel (TaxProfessionalOnboarding) persists an applicant's
 * profile to `professionals/{uid}` and an audit copy to `signed_agreements`.
 * BOTH of those writes are gated on the applicant having a valid, signed-in
 * Firebase session AND on the deployed Firestore rules matching the repo. When
 * either is off (an expired session, or a stale deployed ruleset — the single
 * most common cause of "Missing or insufficient permissions"), every write is
 * rejected. The funnel deliberately swallows those failures so the user is
 * never blocked — which means an applicant can complete the Agreement stage and
 * leave NO server-side record at all. That is exactly the "25 people completed
 * the application but left no saved record" symptom.
 *
 * `free_listings` is the safety net: its Firestore rule is `allow create: if
 * true`, so this write succeeds regardless of auth state or the other
 * collections' rules. It is the durable, admin-visible record of every person
 * who reached the Agreement stage — their promised free listing — independent
 * of whether they go on to complete the optional paid upgrade.
 *
 * This function NEVER throws: lead capture must not break the applicant's flow.
 */

export interface FreeListingLead {
  /** Firebase uid when the applicant is signed in; used to dedupe the lead. */
  uid?: string | null;
  name: string;
  email: string;
  phone?: string;
  businessName?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  /** IRS credentials captured on the intake questions step, when available. */
  ptin?: string;
  efin?: string;
  yearsPreparing?: string;
  /** Agreement metadata so the record ties back to what they signed. */
  agreementVersion?: string;
  signedAt?: string; // ISO string from the signed agreement
  clientIp?: string | null;
  userAgent?: string;
}

export interface CaptureFreeListingResult {
  ok: boolean;
  id: string;
  error?: string;
}

/**
 * Normalizes an email into a safe Firestore document id segment so that a
 * returning applicant who re-signs updates their single lead row rather than
 * creating duplicates. Firestore ids may not contain "/".
 */
const emailKey = (email: string): string =>
  email
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, '_')
    .slice(0, 200);

/**
 * Persist (or merge-update) a free-listing lead for someone who has reached the
 * Agreement stage. Keyed by uid when present, else by normalized email, so the
 * admin follow-up list holds one row per person. Best-effort and non-throwing.
 */
export async function captureFreeListing(
  lead: FreeListingLead,
): Promise<CaptureFreeListingResult> {
  const cleanEmail = (lead.email || '').toLowerCase().trim();
  const docId = lead.uid || (cleanEmail ? emailKey(cleanEmail) : `anon_${Date.now()}`);

  try {
    await setDoc(
      doc(db, 'free_listings', docId),
      {
        firebase_uid: lead.uid || null,
        name: lead.name || '',
        email: cleanEmail,
        email_original: lead.email || '',
        phone: lead.phone || '',
        business_name: lead.businessName || '',
        city: lead.city || '',
        state: lead.state || '',
        zip_code: lead.zipCode || '',
        ptin: lead.ptin || '',
        efin: lead.efin || '',
        years_preparing: lead.yearsPreparing || '',
        agreement_version: lead.agreementVersion || '',
        // Stable, lexically-sortable timestamp of when they signed. The admin
        // list orders on this (ISO strings sort chronologically).
        signed_at: lead.signedAt || new Date().toISOString(),
        client_ip: lead.clientIp ?? null,
        user_agent: lead.userAgent || '',
        source: 'onboarding_agreement',
        // Lifecycle: 'free_listing' until/unless they complete the paid upgrade,
        // at which point the payment step flips this to 'upgraded'.
        status: 'free_listing',
        upgraded: false,
        // `captured_at` reflects the most recent write (create or merge).
        captured_at: serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true, id: docId };
  } catch (err) {
    // Should be rare (open create rule), but we still never throw — the funnel
    // must continue. Surface the reason for diagnostics.
    const msg = err instanceof Error ? err.message : 'free_listings write failed';
    console.warn('captureFreeListing failed (non-blocking):', msg);
    return { ok: false, id: docId, error: msg };
  }
}

/**
 * Mark a previously-captured free listing as upgraded once the applicant
 * completes the optional paid membership. Non-throwing; keyed the same way as
 * capture so it targets the same row.
 */
export async function markFreeListingUpgraded(
  uidOrEmail: string,
  tierName?: string,
): Promise<void> {
  const docId = uidOrEmail.includes('@') ? emailKey(uidOrEmail) : uidOrEmail;
  try {
    await setDoc(
      doc(db, 'free_listings', docId),
      {
        status: 'upgraded',
        upgraded: true,
        upgraded_tier: tierName || '',
        upgraded_at: serverTimestamp(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('markFreeListingUpgraded failed (non-blocking):', err);
  }
}
