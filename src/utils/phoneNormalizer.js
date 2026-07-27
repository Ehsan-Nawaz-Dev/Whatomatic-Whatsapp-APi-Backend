/**
 * Phone Number Normalizer for International WhatsApp Usage
 * 
 * Converts local phone numbers to international format using
 * the country code from the Shopify order's address data.
 */

// ISO 3166-1 Alpha-2 Country Code → Phone Calling Code
const COUNTRY_PHONE_MAP = {
    // Asia
    'PK': '92',   // Pakistan
    'IN': '91',   // India
    'BD': '880',  // Bangladesh
    'LK': '94',   // Sri Lanka
    'NP': '977',  // Nepal
    'AF': '93',   // Afghanistan
    'IR': '98',   // Iran
    'IQ': '964',  // Iraq
    'SA': '966',  // Saudi Arabia
    'AE': '971',  // UAE
    'QA': '974',  // Qatar
    'KW': '965',  // Kuwait
    'BH': '973',  // Bahrain
    'OM': '968',  // Oman
    'YE': '967',  // Yemen
    'JO': '962',  // Jordan
    'LB': '961',  // Lebanon
    'SY': '963',  // Syria
    'PS': '970',  // Palestine
    'IL': '972',  // Israel
    'TR': '90',   // Turkey
    'CN': '86',   // China
    'JP': '81',   // Japan
    'KR': '82',   // South Korea
    'TW': '886',  // Taiwan
    'HK': '852',  // Hong Kong
    'SG': '65',   // Singapore
    'MY': '60',   // Malaysia
    'ID': '62',   // Indonesia
    'TH': '66',   // Thailand
    'VN': '84',   // Vietnam
    'PH': '63',   // Philippines
    'MM': '95',   // Myanmar
    'KH': '855',  // Cambodia
    'LA': '856',  // Laos
    'MN': '976',  // Mongolia
    'KZ': '7',    // Kazakhstan
    'UZ': '998',  // Uzbekistan
    'TM': '993',  // Turkmenistan
    'KG': '996',  // Kyrgyzstan
    'TJ': '992',  // Tajikistan
    'GE': '995',  // Georgia
    'AM': '374',  // Armenia
    'AZ': '994',  // Azerbaijan

    // Europe
    'GB': '44',   // United Kingdom
    'DE': '49',   // Germany
    'FR': '33',   // France
    'IT': '39',   // Italy
    'ES': '34',   // Spain
    'PT': '351',  // Portugal
    'NL': '31',   // Netherlands
    'BE': '32',   // Belgium
    'AT': '43',   // Austria
    'CH': '41',   // Switzerland
    'SE': '46',   // Sweden
    'NO': '47',   // Norway
    'DK': '45',   // Denmark
    'FI': '358',  // Finland
    'IE': '353',  // Ireland
    'PL': '48',   // Poland
    'CZ': '420',  // Czech Republic
    'SK': '421',  // Slovakia
    'HU': '36',   // Hungary
    'RO': '40',   // Romania
    'BG': '359',  // Bulgaria
    'HR': '385',  // Croatia
    'RS': '381',  // Serbia
    'GR': '30',   // Greece
    'UA': '380',  // Ukraine
    'RU': '7',    // Russia
    'BY': '375',  // Belarus
    'LT': '370',  // Lithuania
    'LV': '371',  // Latvia
    'EE': '372',  // Estonia
    'IS': '354',  // Iceland
    'LU': '352',  // Luxembourg
    'MT': '356',  // Malta
    'CY': '357',  // Cyprus
    'AL': '355',  // Albania
    'MK': '389',  // North Macedonia
    'ME': '382',  // Montenegro
    'BA': '387',  // Bosnia
    'SI': '386',  // Slovenia
    'MD': '373',  // Moldova

    // Americas
    'US': '1',    // United States
    'CA': '1',    // Canada
    'MX': '52',   // Mexico
    'BR': '55',   // Brazil
    'AR': '54',   // Argentina
    'CO': '57',   // Colombia
    'CL': '56',   // Chile
    'PE': '51',   // Peru
    'VE': '58',   // Venezuela
    'EC': '593',  // Ecuador
    'BO': '591',  // Bolivia
    'PY': '595',  // Paraguay
    'UY': '598',  // Uruguay
    'CR': '506',  // Costa Rica
    'PA': '507',  // Panama
    'GT': '502',  // Guatemala
    'HN': '504',  // Honduras
    'SV': '503',  // El Salvador
    'NI': '505',  // Nicaragua
    'CU': '53',   // Cuba
    'DO': '1',    // Dominican Republic
    'PR': '1',    // Puerto Rico
    'JM': '1',    // Jamaica
    'TT': '1',    // Trinidad & Tobago
    'HT': '509',  // Haiti
    'BZ': '501',  // Belize
    'GY': '592',  // Guyana
    'SR': '597',  // Suriname

    // Africa
    'ZA': '27',   // South Africa
    'NG': '234',  // Nigeria
    'KE': '254',  // Kenya
    'EG': '20',   // Egypt
    'MA': '212',  // Morocco
    'DZ': '213',  // Algeria
    'TN': '216',  // Tunisia
    'GH': '233',  // Ghana
    'ET': '251',  // Ethiopia
    'TZ': '255',  // Tanzania
    'UG': '256',  // Uganda
    'RW': '250',  // Rwanda
    'SN': '221',  // Senegal
    'CI': '225',  // Ivory Coast
    'CM': '237',  // Cameroon
    'AO': '244',  // Angola
    'MZ': '258',  // Mozambique
    'ZW': '263',  // Zimbabwe
    'BW': '267',  // Botswana
    'MU': '230',  // Mauritius
    'LY': '218',  // Libya
    'SD': '249',  // Sudan
    'CD': '243',  // DR Congo
    'MG': '261',  // Madagascar
    'ML': '223',  // Mali
    'BF': '226',  // Burkina Faso
    'NE': '227',  // Niger
    'MW': '265',  // Malawi
    'ZM': '260',  // Zambia
    'NA': '264',  // Namibia
    'SS': '211',  // South Sudan
    'SO': '252',  // Somalia
    'LR': '231',  // Liberia
    'SL': '232',  // Sierra Leone
    'TG': '228',  // Togo
    'BJ': '229',  // Benin
    'ER': '291',  // Eritrea
    'DJ': '253',  // Djibouti

    // Oceania
    'AU': '61',   // Australia
    'NZ': '64',   // New Zealand
    'FJ': '679',  // Fiji
    'PG': '675',  // Papua New Guinea
};

// Typical local phone number lengths per country (digits after country code)
const LOCAL_NUMBER_LENGTHS = {
    'PK': [10],       // 03xx-xxxxxxx → 10 digits local
    'IN': [10],       // 9876543210
    'US': [10],       // (555) 123-4567
    'CA': [10],
    'GB': [10, 11],   // 07xxx xxxxxx
    'AU': [9],        // 04xx xxx xxx
    'SA': [9],        // 5xxxxxxxx
    'AE': [9],        // 5xxxxxxxx
    'BD': [10, 11],
    'TR': [10],
    'DE': [10, 11],
    'FR': [9],
    'BR': [10, 11],
    'MX': [10],
    'NG': [10, 11],
    'ZA': [9],
    'KE': [9],
    'EG': [10],
    'MY': [9, 10],
    'ID': [10, 11, 12],
    'PH': [10],
    'TH': [9],
};

/**
 * Normalizes a phone number to international format for WhatsApp.
 * 
 * @param {string} rawPhone - The raw phone number (digits only or with formatting)
 * @param {object} order - The Shopify order object (used to detect country)
 * @param {string} defaultCountryCode - Fallback country code (e.g. 'PK', 'US')
 * @returns {string|null} - The normalized phone number or null if invalid
 */
export function normalizePhoneNumber(rawPhone, order = null, defaultCountryCode = null) {
    if (!rawPhone) return null;

    // Step 1: Strip all non-digit characters
    let digits = rawPhone.replace(/\D/g, '');

    if (!digits || digits.length < 7) return null; // Too short to be valid

    // Step 2: If starts with '+', it's already international (the + was stripped)
    // Check if the original had a + prefix
    const hadPlus = rawPhone.trim().startsWith('+');

    // Step 3: Detect the customer's country from the order
    let countryCode = detectCountryFromOrder(order);
    if (!countryCode && defaultCountryCode) {
        countryCode = defaultCountryCode.toUpperCase();
    }
    const callingCode = countryCode ? COUNTRY_PHONE_MAP[countryCode] : null;

    console.log(`[PhoneNorm] Raw: ${rawPhone} → Digits: ${digits}, Country: ${countryCode || 'unknown'}, CallingCode: ${callingCode || 'none'}`);

    // Step 4: If already has a + prefix, trust it as international
    if (hadPlus && digits.length >= 10) {
        console.log(`[PhoneNorm] Already international (had +): ${digits}`);
        return digits;
    }

    // Step 5: If the number already starts with the calling code, it's likely international
    if (callingCode && digits.startsWith(callingCode)) {
        const localPart = digits.substring(callingCode.length);
        // Verify the local part length is reasonable (at least 7 digits)
        if (localPart.length >= 7) {
            console.log(`[PhoneNorm] Already has country code ${callingCode}: ${digits}`);
            return digits;
        }
    }

    // Step 6: Handle leading zero (common in many countries: 0xxx → country_code + xxx)
    if (digits.startsWith('0') && callingCode) {
        const withoutZero = digits.substring(1);
        // Make sure stripping zero gives a reasonable length
        if (withoutZero.length >= 7) {
            const result = callingCode + withoutZero;
            console.log(`[PhoneNorm] Stripped leading zero, added ${callingCode}: ${result}`);
            return result;
        }
    }

    // Step 7: Handle "00" prefix (international dialing prefix)
    if (digits.startsWith('00') && digits.length > 10) {
        const result = digits.substring(2);
        console.log(`[PhoneNorm] Stripped 00 prefix: ${result}`);
        return result;
    }

    // Step 8: Local number without any prefix — add the country calling code
    if (callingCode) {
        // Check known local lengths for this country
        const knownLengths = LOCAL_NUMBER_LENGTHS[countryCode];

        if (knownLengths && knownLengths.includes(digits.length)) {
            // Exact match for known local number length
            const result = callingCode + digits;
            console.log(`[PhoneNorm] Local number (${digits.length} digits), added ${callingCode}: ${result}`);
            return result;
        }

        // For numbers that are shorter than typical international (< 12 digits),
        // assume they're local and need the country code
        if (digits.length <= 11 && !digits.startsWith(callingCode)) {
            const result = callingCode + digits;
            console.log(`[PhoneNorm] Assumed local number, added ${callingCode}: ${result}`);
            return result;
        }
    }

    // Step 9: If number is already long enough (12+ digits), assume it's international
    if (digits.length >= 12) {
        console.log(`[PhoneNorm] Long number, assuming international: ${digits}`);
        return digits;
    }

    // Step 10: Fallback - return as-is (let WhatsApp check handle it)
    console.log(`[PhoneNorm] Fallback, returning as-is: ${digits}`);
    return digits;
}

/**
 * Detects the customer's country from Shopify order data.
 * Checks shipping address, billing address, and customer default address.
 * 
 * @param {object} order - The Shopify order object
 * @returns {string|null} - ISO 3166-1 Alpha-2 country code (e.g., 'PK', 'US') or null
 */
function detectCountryFromOrder(order) {
    if (!order) return null;

    if (typeof order === 'string') {
        if (order.length === 2) return order.toUpperCase();
        const COUNTRY_NAME_MAP = {
            'pakistan': 'PK', 'india': 'IN', 'united states': 'US', 'usa': 'US',
            'united kingdom': 'GB', 'uk': 'GB', 'canada': 'CA', 'australia': 'AU',
            'saudi arabia': 'SA', 'uae': 'AE', 'united arab emirates': 'AE',
            'germany': 'DE', 'france': 'FR', 'turkey': 'TR', 'china': 'CN',
            'brazil': 'BR', 'south africa': 'ZA', 'nigeria': 'NG', 'kenya': 'KE',
            'egypt': 'EG', 'bangladesh': 'BD', 'sri lanka': 'LK', 'nepal': 'NP',
            'malaysia': 'MY', 'indonesia': 'ID', 'thailand': 'TH', 'japan': 'JP',
            'south korea': 'KR', 'singapore': 'SG', 'philippines': 'PH',
            'new zealand': 'NZ', 'mexico': 'MX', 'colombia': 'CO',
            'argentina': 'AR', 'chile': 'CL',
        };
        return COUNTRY_NAME_MAP[order.toLowerCase()] || null;
    }

    // Priority: shipping → billing → customer default
    const country =
        order.shipping_address?.country_code ||
        order.billing_address?.country_code ||
        order.customer?.default_address?.country_code ||
        order.shipping_address?.country ||
        order.billing_address?.country ||
        null;

    if (!country) return null;

    // If it's already a 2-letter code, return it uppercased
    if (country.length === 2) return country.toUpperCase();

    // If it's a full country name, try to map it
    const COUNTRY_NAME_MAP = {
        'pakistan': 'PK', 'india': 'IN', 'united states': 'US', 'usa': 'US',
        'united kingdom': 'GB', 'uk': 'GB', 'canada': 'CA', 'australia': 'AU',
        'saudi arabia': 'SA', 'uae': 'AE', 'united arab emirates': 'AE',
        'germany': 'DE', 'france': 'FR', 'turkey': 'TR', 'china': 'CN',
        'brazil': 'BR', 'south africa': 'ZA', 'nigeria': 'NG', 'kenya': 'KE',
        'egypt': 'EG', 'bangladesh': 'BD', 'sri lanka': 'LK', 'nepal': 'NP',
        'malaysia': 'MY', 'indonesia': 'ID', 'thailand': 'TH', 'japan': 'JP',
        'south korea': 'KR', 'singapore': 'SG', 'philippines': 'PH',
        'new zealand': 'NZ', 'mexico': 'MX', 'colombia': 'CO',
        'argentina': 'AR', 'chile': 'CL',
    };

    return COUNTRY_NAME_MAP[country.toLowerCase()] || null;
}

export { COUNTRY_PHONE_MAP, detectCountryFromOrder };
