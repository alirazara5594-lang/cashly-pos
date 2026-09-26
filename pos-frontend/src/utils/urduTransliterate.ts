/**
 * English → Urdu transliteration for menu item names.
 *
 * TRANSLITERATION, not translation — it spells the English sound in Urdu script rather than
 * finding the Urdu word for the thing. That matches how the existing catalogue is written:
 * "Chicken Tikka Pizza" is "چکن تکہ پیزا" (chikan tikka pizza), not "مرغی" (murghi), which is
 * what an actual translation of "chicken" would give. Restaurant menus here are read aloud by
 * staff taking orders, so the sound is the part that has to survive.
 *
 * Two passes:
 *   1. A dictionary of terms that already have a settled spelling on Pakistani menus. Most
 *      real item names are built almost entirely from these.
 *   2. A phonetic fallback for anything unknown, which is approximate by nature.
 *
 * The output is a starting point the user edits, never the last word — which is why the field
 * stays editable and stops auto-filling the moment it is touched.
 */

/** Words with an established Urdu spelling on local menus. Keys are lowercase. */
const DICTIONARY: Record<string, string> = {
  // Core items
  burger: 'برگر', pizza: 'پیزا', sandwich: 'سینڈوچ', wrap: 'ریپ', roll: 'رول',
  fries: 'فرائز', shawarma: 'شوارما', pasta: 'پاستا', noodles: 'نوڈلز', soup: 'سوپ',
  salad: 'سلاد', rice: 'رائس', biryani: 'بریانی', pulao: 'پلاؤ', karahi: 'کڑاہی',
  handi: 'ہانڈی', qorma: 'قورمہ', korma: 'قورمہ', nihari: 'نہاری', haleem: 'حلیم',
  kebab: 'کباب', kabab: 'کباب', seekh: 'سیخ', boti: 'بوٹی', tikka: 'تکہ',
  paratha: 'پراٹھا', naan: 'نان', roti: 'روٹی', samosa: 'سموسہ', pakora: 'پکوڑا',
  steak: 'اسٹیک', nuggets: 'نگٹس', wings: 'ونگز', platter: 'پلیٹر', bowl: 'باؤل',

  // Proteins
  chicken: 'چکن', beef: 'بیف', mutton: 'مٹن', fish: 'فش', prawn: 'پران',
  egg: 'انڈا', cheese: 'چیز', veg: 'ویج', vegetable: 'ویجیٹیبل',

  // Drinks
  tea: 'چائے', chai: 'چائے', coffee: 'کافی', water: 'واٹر', juice: 'جوس',
  shake: 'شیک', smoothie: 'سموتھی', lassi: 'لسی', soda: 'سوڈا', cola: 'کولا',
  pepsi: 'پیپسی', coke: 'کوک', sprite: 'اسپرائٹ', margarita: 'مارگریٹا',
  mojito: 'موہیتو', latte: 'لاتے', cappuccino: 'کیپوچینو', espresso: 'ایسپریسو',

  // Desserts
  kheer: 'کھیر', falooda: 'فالودہ', halwa: 'حلوہ', barfi: 'برفی', cake: 'کیک',
  brownie: 'براؤنی', pudding: 'پڈنگ', custard: 'کسٹرڈ', icecream: 'آئس کریم',

  // Descriptors
  classic: 'کلاسک', special: 'اسپیشل', royal: 'رائل', crispy: 'کرسپی',
  crunch: 'کرنچ', crunchy: 'کرنچی', smash: 'سمیش', zinger: 'زنگر',
  loaded: 'لوڈڈ', gourmet: 'گورمے', fresh: 'فریش', hot: 'ہاٹ', cold: 'کولڈ',
  spicy: 'اسپائسی', grilled: 'گرلڈ', fried: 'فرائیڈ', roasted: 'روسٹڈ',
  smoked: 'اسموکڈ', creamy: 'کریمی', cheesy: 'چیزی', sweet: 'سویٹ',
  mint: 'منٹ', garlic: 'گارلک', mayo: 'میو', sauce: 'ساس', chutney: 'چٹنی',
  raita: 'رائتہ', masala: 'مصالحہ', malai: 'ملائی', desi: 'دیسی',

  // Sizing / packaging
  small: 'سمال', medium: 'میڈیم', large: 'لارج', regular: 'ریگولر',
  half: 'ہاف', full: 'فل', single: 'سنگل', double: 'ڈبل', triple: 'ٹرپل',
  combo: 'کومبو', deal: 'ڈیل', family: 'فیملی', party: 'پارٹی', extra: 'ایکسٹرا',
  plate: 'پلیٹ', piece: 'پیس', pieces: 'پیسز', box: 'باکس', bucket: 'بکٹ'
};

/**
 * Sound groups, longest first — "sh" has to be consumed before "s" and "h" are looked at
 * separately, or "shake" comes out as "سہاکے".
 */
const PHONETIC: [string, string][] = [
  ['tion', 'شن'], ['ough', 'او'], ['ight', 'ائٹ'],
  ['sch', 'سک'], ['tch', 'چ'], ['ch', 'چ'], ['sh', 'ش'], ['th', 'تھ'],
  ['ph', 'ف'], ['kh', 'کھ'], ['gh', 'گھ'], ['ck', 'ک'], ['qu', 'کو'],
  ['ee', 'ی'], ['ea', 'ی'], ['oo', 'او'], ['ou', 'او'], ['au', 'او'],
  ['aw', 'او'], ['ai', 'ای'], ['ay', 'ے'], ['ey', 'ے'], ['oa', 'او'],
  ['oi', 'وائے'], ['oy', 'وائے'], ['ie', 'ی'],
  ['a', 'ا'], ['b', 'ب'], ['c', 'ک'], ['d', 'ڈ'], ['e', 'ی'], ['f', 'ف'],
  ['g', 'گ'], ['h', 'ہ'], ['i', 'ی'], ['j', 'ج'], ['k', 'ک'], ['l', 'ل'],
  ['m', 'م'], ['n', 'ن'], ['o', 'او'], ['p', 'پ'], ['q', 'ق'], ['r', 'ر'],
  ['s', 'س'], ['t', 'ٹ'], ['u', 'و'], ['v', 'و'], ['w', 'و'], ['x', 'کس'],
  ['y', 'ی'], ['z', 'ز']
];

/** Sounds out one unknown word. Rough by construction — the dictionary carries the real work. */
function phonetic(word: string): string {
  let w = word;
  let tail = '';

  // English word endings that the letter-by-letter pass gets wrong often enough to be worth
  // special-casing: a silent final "e" ("deluxe"), an unstressed "-er" that is one ر rather
  // than ے + ر ("stacker"), and a final "o" that is و rather than او ("mango").
  if (w.length > 3 && w.endsWith('e') && !w.endsWith('ee')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('er')) {
    w = w.slice(0, -2);
    tail = 'ر';
  } else if (w.length > 2 && w.endsWith('o')) {
    w = w.slice(0, -1);
    tail = 'و';
  }

  let out = '';
  let i = 0;
  while (i < w.length) {
    const match = PHONETIC.find(([en]) => w.startsWith(en, i));
    if (match) {
      out += match[1];
      i += match[0].length;
    } else {
      // A digit or symbol: keep it as-is rather than dropping it.
      out += w[i];
      i += 1;
    }
  }
  return out + tail;
}

/**
 * Transliterates a full product name. Returns '' for empty input so callers can treat a blank
 * name as "nothing to suggest" rather than having to special-case it.
 */
export function toUrdu(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';

  return trimmed
    .split(/\s+/)
    .map(rawWord => {
      // Keep any trailing punctuation out of the lookup, then put it back.
      const core = rawWord.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (!core) return rawWord;

      // Pure numbers and measures read the same in both scripts.
      if (/^\d+$/.test(core)) return core;

      return DICTIONARY[core] ?? phonetic(core);
    })
    .join(' ');
}
