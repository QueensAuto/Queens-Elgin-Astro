export type BrandConfig = {
    id: string;
    name: string;
    schemaName?: string; // Exact GBP name for schema markup (must match character-for-character)
    /** Public Cloudflare Turnstile site key for the contact form (secret lives in CF as TURNSTILE_SECRET_KEY). */
    turnstileSiteKey?: string;
    domain?: string;
    logoPath: string;
    logoPathWhite?: string;
    primaryColor: string;
    accentColor: string;
    phone: string;
    email: string;
    address: string;
    cityLabel: string;
    googleMapsUrl?: string;
    gaId?: string;
    metaPixelId?: string;
    latitude?: number;
    longitude?: number;
    streetAddress?: string;
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    ratingValue?: string;
    reviewCount?: string;
    shopImage?: string;
};
