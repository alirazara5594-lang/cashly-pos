namespace Pos.Api.Data;

/// <summary>State/province option shown once a country with known subdivisions is picked.</summary>
public record CountryState(string Code, string Name);

/// <summary>
/// A country's signup defaults: locale (phone/currency) plus a starting tax configuration.
///
/// The tax fields are deliberately conservative. Real sales-tax/VAT correctness at
/// state/county granularity is what dedicated services (Avalara, TaxJar, Stripe Tax) exist to
/// solve — this table gives the OWNER a sensible starting point, not a compliance guarantee.
/// Where a country has one stable, well-known national rate (UAE, Saudi, UK VAT), we seed it.
/// Where it genuinely varies below the country level (the US), we deliberately do NOT invent a
/// number — DefaultTaxRate stays null and the UI must say so plainly.
/// </summary>
public record CountryProfile(
    string Name,
    string Iso2,
    string PhoneCode,
    string CurrencyCode,
    string CurrencySymbol,
    string? TaxAuthorityName,
    decimal? DefaultTaxRate,
    decimal? DigitalTaxRate,
    bool UseDualTaxRate,
    bool UseProvincialTax,
    string TaxNote,
    List<CountryState>? States
);

public static class CountryTaxProfiles
{
    /// <summary>
    /// The 5 countries with a real, maintained tax starting point. Pakistan's provincial rates
    /// live in the existing <see cref="Pos.Api.Models.TaxJurisdiction"/> table (single source of
    /// truth — not duplicated here); everyone else gets one flat national rate or an explicit
    /// "we don't know, please set it" flag.
    /// </summary>
    private static readonly List<CountryProfile> Detailed = new()
    {
        new("Pakistan", "PK", "+92", "PKR", "₨", "FBR", 16, 8, true, true,
            "Cash vs. digital-payment tax split applies automatically (FBR policy). Pick your province to enable provincial rates.",
            new() {
                new("PK-PB", "Punjab"), new("PK-SD", "Sindh"), new("PK-KP", "Khyber Pakhtunkhwa"),
                new("PK-BA", "Balochistan"), new("PK-ICT", "Islamabad Capital Territory")
            }),
        new("United Arab Emirates", "AE", "+971", "AED", "د.إ", "Federal Tax Authority (FTA)", 5, 5, false, false,
            "Flat 5% VAT nationwide.",
            new() {
                new("AE-AZ", "Abu Dhabi"), new("AE-DU", "Dubai"), new("AE-SH", "Sharjah"),
                new("AE-AJ", "Ajman"), new("AE-UQ", "Umm Al Quwain"), new("AE-RK", "Ras Al Khaimah"), new("AE-FU", "Fujairah")
            }),
        new("Saudi Arabia", "SA", "+966", "SAR", "ر.س", "Zakat, Tax and Customs Authority (ZATCA)", 15, 15, false, false,
            "Flat 15% VAT nationwide.",
            new() {
                new("SA-RI", "Riyadh"), new("SA-MK", "Makkah"), new("SA-MD", "Madinah"), new("SA-EP", "Eastern Province"),
                new("SA-AS", "Asir"), new("SA-JZ", "Jazan"), new("SA-TB", "Tabuk"), new("SA-HA", "Hail"),
                new("SA-NB", "Northern Borders"), new("SA-NJ", "Najran"), new("SA-JF", "Al Jawf"),
                new("SA-BH", "Al Bahah"), new("SA-QS", "Al Qassim")
            }),
        new("United Kingdom", "GB", "+44", "GBP", "£", "HM Revenue & Customs (HMRC)", 20, 20, false, false,
            "Flat 20% VAT nationwide.",
            new() {
                new("GB-ENG", "England"), new("GB-SCT", "Scotland"), new("GB-WLS", "Wales"), new("GB-NIR", "Northern Ireland")
            }),
        new("United States", "US", "+1", "USD", "$", null, null, null, false, false,
            "Sales tax varies by state and county — no safe default exists. Set your rate after signup.",
            new() {
                new("US-AL","Alabama"), new("US-AK","Alaska"), new("US-AZ","Arizona"), new("US-AR","Arkansas"),
                new("US-CA","California"), new("US-CO","Colorado"), new("US-CT","Connecticut"), new("US-DE","Delaware"),
                new("US-FL","Florida"), new("US-GA","Georgia"), new("US-HI","Hawaii"), new("US-ID","Idaho"),
                new("US-IL","Illinois"), new("US-IN","Indiana"), new("US-IA","Iowa"), new("US-KS","Kansas"),
                new("US-KY","Kentucky"), new("US-LA","Louisiana"), new("US-ME","Maine"), new("US-MD","Maryland"),
                new("US-MA","Massachusetts"), new("US-MI","Michigan"), new("US-MN","Minnesota"), new("US-MS","Mississippi"),
                new("US-MO","Missouri"), new("US-MT","Montana"), new("US-NE","Nebraska"), new("US-NV","Nevada"),
                new("US-NH","New Hampshire"), new("US-NJ","New Jersey"), new("US-NM","New Mexico"), new("US-NY","New York"),
                new("US-NC","North Carolina"), new("US-ND","North Dakota"), new("US-OH","Ohio"), new("US-OK","Oklahoma"),
                new("US-OR","Oregon"), new("US-PA","Pennsylvania"), new("US-RI","Rhode Island"), new("US-SC","South Carolina"),
                new("US-SD","South Dakota"), new("US-TN","Tennessee"), new("US-TX","Texas"), new("US-UT","Utah"),
                new("US-VT","Vermont"), new("US-VA","Virginia"), new("US-WA","Washington"), new("US-WV","West Virginia"),
                new("US-WI","Wisconsin"), new("US-WY","Wyoming"), new("US-DC","District of Columbia")
            }),
    };

    /// <summary>
    /// Everyone else — real countries (recognizable name/phone code/currency), no state list and
    /// no invented tax number. India is intentionally excluded (not a target market yet).
    /// </summary>
    private static readonly (string Name, string Iso2, string Phone, string Cur, string Sym)[] Generic = new[]
    {
        ("Afghanistan","AF","+93","AFN","؋"), ("Albania","AL","+355","ALL","L"), ("Algeria","DZ","+213","DZD","د.ج"),
        ("Andorra","AD","+376","EUR","€"), ("Angola","AO","+244","AOA","Kz"), ("Argentina","AR","+54","ARS","$"),
        ("Armenia","AM","+374","AMD","֏"), ("Australia","AU","+61","AUD","$"), ("Austria","AT","+43","EUR","€"),
        ("Azerbaijan","AZ","+994","AZN","₼"), ("Bahamas","BS","+1242","BSD","$"), ("Bahrain","BH","+973","BHD",".د.ب"),
        ("Bangladesh","BD","+880","BDT","৳"), ("Barbados","BB","+1246","BBD","$"), ("Belarus","BY","+375","BYN","Br"),
        ("Belgium","BE","+32","EUR","€"), ("Belize","BZ","+501","BZD","$"), ("Benin","BJ","+229","XOF","Fr"),
        ("Bhutan","BT","+975","BTN","Nu."), ("Bolivia","BO","+591","BOB","Bs."), ("Bosnia and Herzegovina","BA","+387","BAM","KM"),
        ("Botswana","BW","+267","BWP","P"), ("Brazil","BR","+55","BRL","R$"), ("Brunei","BN","+673","BND","$"),
        ("Bulgaria","BG","+359","BGN","лв"), ("Burkina Faso","BF","+226","XOF","Fr"), ("Burundi","BI","+257","BIF","Fr"),
        ("Cambodia","KH","+855","KHR","៛"), ("Cameroon","CM","+237","XAF","Fr"), ("Canada","CA","+1","CAD","$"),
        ("Cape Verde","CV","+238","CVE","$"), ("Central African Republic","CF","+236","XAF","Fr"), ("Chad","TD","+235","XAF","Fr"),
        ("Chile","CL","+56","CLP","$"), ("China","CN","+86","CNY","¥"), ("Colombia","CO","+57","COP","$"),
        ("Comoros","KM","+269","KMF","Fr"), ("Congo (DRC)","CD","+243","CDF","Fr"), ("Congo (Republic)","CG","+242","XAF","Fr"),
        ("Costa Rica","CR","+506","CRC","₡"), ("Croatia","HR","+385","EUR","€"), ("Cuba","CU","+53","CUP","$"),
        ("Cyprus","CY","+357","EUR","€"), ("Czech Republic","CZ","+420","CZK","Kč"), ("Denmark","DK","+45","DKK","kr"),
        ("Djibouti","DJ","+253","DJF","Fr"), ("Dominica","DM","+1767","XCD","$"), ("Dominican Republic","DO","+1809","DOP","$"),
        ("Ecuador","EC","+593","USD","$"), ("Egypt","EG","+20","EGP","£"), ("El Salvador","SV","+503","USD","$"),
        ("Equatorial Guinea","GQ","+240","XAF","Fr"), ("Eritrea","ER","+291","ERN","Nfk"), ("Estonia","EE","+372","EUR","€"),
        ("Eswatini","SZ","+268","SZL","L"), ("Ethiopia","ET","+251","ETB","Br"), ("Fiji","FJ","+679","FJD","$"),
        ("Finland","FI","+358","EUR","€"), ("France","FR","+33","EUR","€"), ("Gabon","GA","+241","XAF","Fr"),
        ("Gambia","GM","+220","GMD","D"), ("Georgia","GE","+995","GEL","₾"), ("Germany","DE","+49","EUR","€"),
        ("Ghana","GH","+233","GHS","₵"), ("Greece","GR","+30","EUR","€"), ("Grenada","GD","+1473","XCD","$"),
        ("Guatemala","GT","+502","GTQ","Q"), ("Guinea","GN","+224","GNF","Fr"), ("Guinea-Bissau","GW","+245","XOF","Fr"),
        ("Guyana","GY","+592","GYD","$"), ("Haiti","HT","+509","HTG","G"), ("Honduras","HN","+504","HNL","L"),
        ("Hong Kong","HK","+852","HKD","$"), ("Hungary","HU","+36","HUF","Ft"), ("Iceland","IS","+354","ISK","kr"),
        ("India","IN","+91","INR","₹"),
        ("Indonesia","ID","+62","IDR","Rp"), ("Iran","IR","+98","IRR","﷼"), ("Iraq","IQ","+964","IQD","ع.د"),
        ("Ireland","IE","+353","EUR","€"), ("Israel","IL","+972","ILS","₪"), ("Italy","IT","+39","EUR","€"),
        ("Ivory Coast","CI","+225","XOF","Fr"), ("Jamaica","JM","+1876","JMD","$"), ("Japan","JP","+81","JPY","¥"),
        ("Jordan","JO","+962","JOD","د.ا"), ("Kazakhstan","KZ","+7","KZT","₸"), ("Kenya","KE","+254","KES","Sh"),
        ("Kiribati","KI","+686","AUD","$"), ("Kosovo","XK","+383","EUR","€"), ("Kuwait","KW","+965","KWD","د.ك"),
        ("Kyrgyzstan","KG","+996","KGS","с"), ("Laos","LA","+856","LAK","₭"), ("Latvia","LV","+371","EUR","€"),
        ("Lebanon","LB","+961","LBP","ل.ل"), ("Lesotho","LS","+266","LSL","L"), ("Liberia","LR","+231","LRD","$"),
        ("Libya","LY","+218","LYD","ل.د"), ("Liechtenstein","LI","+423","CHF","Fr"), ("Lithuania","LT","+370","EUR","€"),
        ("Luxembourg","LU","+352","EUR","€"), ("Macau","MO","+853","MOP","P"), ("Madagascar","MG","+261","MGA","Ar"),
        ("Malawi","MW","+265","MWK","MK"), ("Malaysia","MY","+60","MYR","RM"), ("Maldives","MV","+960","MVR","Rf"),
        ("Mali","ML","+223","XOF","Fr"), ("Malta","MT","+356","EUR","€"), ("Mauritania","MR","+222","MRU","UM"),
        ("Mauritius","MU","+230","MUR","₨"), ("Mexico","MX","+52","MXN","$"), ("Moldova","MD","+373","MDL","L"),
        ("Monaco","MC","+377","EUR","€"), ("Mongolia","MN","+976","MNT","₮"), ("Montenegro","ME","+382","EUR","€"),
        ("Morocco","MA","+212","MAD","د.م."), ("Mozambique","MZ","+258","MZN","MT"), ("Myanmar","MM","+95","MMK","K"),
        ("Namibia","NA","+264","NAD","$"), ("Nepal","NP","+977","NPR","₨"), ("Netherlands","NL","+31","EUR","€"),
        ("New Zealand","NZ","+64","NZD","$"), ("Nicaragua","NI","+505","NIO","C$"), ("Niger","NE","+227","XOF","Fr"),
        ("Nigeria","NG","+234","NGN","₦"), ("North Korea","KP","+850","KPW","₩"), ("North Macedonia","MK","+389","MKD","ден"),
        ("Norway","NO","+47","NOK","kr"), ("Oman","OM","+968","OMR","ر.ع."), ("Palestine","PS","+970","ILS","₪"),
        ("Panama","PA","+507","PAB","B/."), ("Papua New Guinea","PG","+675","PGK","K"), ("Paraguay","PY","+595","PYG","₲"),
        ("Peru","PE","+51","PEN","S/"), ("Philippines","PH","+63","PHP","₱"), ("Poland","PL","+48","PLN","zł"),
        ("Portugal","PT","+351","EUR","€"), ("Qatar","QA","+974","QAR","ر.ق"), ("Romania","RO","+40","RON","lei"),
        ("Russia","RU","+7","RUB","₽"), ("Rwanda","RW","+250","RWF","Fr"), ("Samoa","WS","+685","WST","T"),
        ("San Marino","SM","+378","EUR","€"), ("Senegal","SN","+221","XOF","Fr"), ("Serbia","RS","+381","RSD","дин"),
        ("Seychelles","SC","+248","SCR","₨"), ("Sierra Leone","SL","+232","SLE","Le"), ("Singapore","SG","+65","SGD","$"),
        ("Slovakia","SK","+421","EUR","€"), ("Slovenia","SI","+386","EUR","€"), ("Solomon Islands","SB","+677","SBD","$"),
        ("Somalia","SO","+252","SOS","Sh"), ("South Africa","ZA","+27","ZAR","R"), ("South Korea","KR","+82","KRW","₩"),
        ("South Sudan","SS","+211","SSP","£"), ("Spain","ES","+34","EUR","€"), ("Sri Lanka","LK","+94","LKR","Rs"),
        ("Sudan","SD","+249","SDG","ج.س."), ("Suriname","SR","+597","SRD","$"), ("Sweden","SE","+46","SEK","kr"),
        ("Switzerland","CH","+41","CHF","Fr"), ("Syria","SY","+963","SYP","£"), ("Taiwan","TW","+886","TWD","$"),
        ("Tajikistan","TJ","+992","TJS","ЅМ"), ("Tanzania","TZ","+255","TZS","Sh"), ("Thailand","TH","+66","THB","฿"),
        ("Timor-Leste","TL","+670","USD","$"), ("Togo","TG","+228","XOF","Fr"), ("Tonga","TO","+676","TOP","T$"),
        ("Trinidad and Tobago","TT","+1868","TTD","$"), ("Tunisia","TN","+216","TND","د.ت"), ("Turkey","TR","+90","TRY","₺"),
        ("Turkmenistan","TM","+993","TMT","m"), ("Tuvalu","TV","+688","AUD","$"), ("Uganda","UG","+256","UGX","Sh"),
        ("Ukraine","UA","+380","UAH","₴"), ("Uruguay","UY","+598","UYU","$"), ("Uzbekistan","UZ","+998","UZS","so'm"),
        ("Vanuatu","VU","+678","VUV","Vt"), ("Vatican City","VA","+379","EUR","€"), ("Venezuela","VE","+58","VES","Bs."),
        ("Vietnam","VN","+84","VND","₫"), ("Yemen","YE","+967","YER","﷼"), ("Zambia","ZM","+260","ZMW","ZK"),
        ("Zimbabwe","ZW","+263","ZWL","$"),
    };

    public static readonly List<CountryProfile> All = BuildAll();

    private static List<CountryProfile> BuildAll()
    {
        var list = new List<CountryProfile>(Detailed);
        list.AddRange(Generic.Select(g => new CountryProfile(
            g.Name, g.Iso2, g.Phone, g.Cur, g.Sym,
            null, null, null, false, false,
            "No default tax rate configured for this country yet — set your rate after signup.",
            null)));
        return list.OrderBy(c => c.Name, StringComparer.Ordinal).ToList();
    }

    public static CountryProfile? FindByName(string? name) =>
        string.IsNullOrWhiteSpace(name) ? null : All.FirstOrDefault(c => c.Name.Equals(name.Trim(), StringComparison.OrdinalIgnoreCase));
}
