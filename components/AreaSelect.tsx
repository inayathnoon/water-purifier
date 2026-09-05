'use client';

// Kannur revenue villages (source: Wikipedia, "Political divisions of
// Kannur district" — this is where the business actually operates, so it
// gets full village-level detail, taluk by taluk). Thalassery Taluk
// listed first — most of the business's real customers are there.
//
// This is a free-text input with these as <datalist> suggestions, not a
// rigid <select> — real historical customer data (imported from the
// business's own CSVs) uses area names that don't always match this
// curated list at all (different spelling, or a place not on it), and a
// <select> silently can't display a value that isn't one of its own
// options. A known customer's actual stored area — whatever it is —
// always shows correctly this way; the list just offers convenient
// autocomplete for a new one.
const KANNUR_VILLAGES: Record<string, string[]> = {
  'Thalassery Taluk': [
    'Cheruvanchery', 'Chokli', 'Dharmadam', 'Erancholi', 'Eruvatty', 'Kadirur', 'Kandankunnu',
    'Kannavam', 'Keezhallur', 'Kodiyeri', 'Kolavallur', 'Kolayad', 'Koodali', 'Kottayam',
    'Kuthuparamba', 'Mananthery', 'Mangattidam', 'Mokery', 'New Mahe', 'Paduvilayi',
    'Panniyannur', 'Panoor', 'Pathiriyad', 'Pattanur', 'Pattiam', 'Peringalam', 'Peringathur',
    'Pinarayi', 'Puthur', 'Shivapuram', 'Thalassery', 'Thiruvangad', 'Tholambra',
    'Thripangothur', 'Vekkalam',
  ],
  'Kannur Taluk': [
    'Anjarakandi', 'Azhikode North', 'Azhikode South', 'Chelora', 'Chembilode', 'Cherukkunnu',
    'Chirakkal', 'Edakkad', 'Elayavoor', 'Iriveri', 'Kadambur', 'Kalliasseri', 'Kanhirod',
    'Kannadiparamba', 'Kannapuram', 'Kannur-1', 'Kannur-2', 'Makrery', 'Mattool', 'Mavilayi',
    'Munderi', 'Muzhappilangad', 'Narath', 'Pallikkunnu', 'Pappinisseri', 'Puzhathi',
    'Valapattanam', 'Valiyannur',
  ],
  'Taliparamba Taluk': [
    'Alakode', 'Anthoor', 'Chelery', 'Chengalayi', 'Chuzhali', 'Eruvessi', 'Irikkur',
    'Kayaralam', 'Kolachery', 'Kooveri', 'Kurumathur', 'Kuttiyattoor', 'Kuttiyeri',
    'Malappattam', 'Maniyoor', 'Mayyil', 'Morazha', 'Naduvil', 'Nidiyanga', 'Panniyoor',
    'Pariyaram', 'Pattuvam', 'Payyavoor', 'Sreekandapuram', 'Taliparamba', 'Thimiri',
    'Udayagiri', 'Velladu',
  ],
  'Payyanur Taluk': [
    'Alappadamba', 'Cheruthazham', 'Eramam', 'Ezhome', 'Kadannappally', 'Kankol', 'Karivellur',
    'Korom', 'Kuttur', 'Kunhimangalam', 'Madayi', 'Panappuzha', 'Payyanur', 'Peralam',
    'Peringome', 'Perinthatta', 'Pulingome', 'Ramanthali', 'Thirumeni', 'Vayakkara', 'Vellora',
    'Vellur',
  ],
  'Iritty Taluk': [
    'Aralam', 'Ayyankunnu', 'Chavasseri', 'Kalliad', 'Kanichar', 'Karikottakari', 'Keezhur',
    'Kelakam', 'Kolari', 'Kottiyoor', 'Manathana', 'Muzhakkunnu', 'Nuchiyad', 'Padiyoor',
    'Payam', 'Pazhassi', 'Thillankeri', 'Vayathur', 'Vellarvalli', 'Vilamana',
  ],
};

// Neighboring districts get taluk-level detail, not full village lists.
const NEIGHBORING_DISTRICT_TALUKS: Record<string, string[]> = {
  Kozhikode: ['Kozhikode Taluk', 'Koyilandy Taluk', 'Thamarassery Taluk', 'Vadakara Taluk'],
  Kasaragod: ['Kasaragod Taluk', 'Hosdurg Taluk', 'Vellarikundu Taluk', 'Manjeshwaram Taluk'],
  Malappuram: [
    'Tirur Taluk', 'Ponnani Taluk', 'Tirurangadi Taluk', 'Kondotty Taluk',
    'Nilambur Taluk', 'Eranad Taluk', 'Perinthalmanna Taluk',
  ],
};

// Everywhere else in Kerala — district-level only, at the bottom, in caps.
const OTHER_KERALA_DISTRICTS = [
  'THIRUVANANTHAPURAM', 'KOLLAM', 'PATHANAMTHITTA', 'ALAPPUZHA', 'KOTTAYAM',
  'IDUKKI', 'ERNAKULAM', 'THRISSUR', 'PALAKKAD', 'WAYANAD',
];

const ALL_SUGGESTIONS = [
  ...Object.values(KANNUR_VILLAGES).flat(),
  ...Object.values(NEIGHBORING_DISTRICT_TALUKS).flat(),
  ...OTHER_KERALA_DISTRICTS,
];

export default function AreaSelect({
  value,
  onChange,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <>
      <input
        required={required}
        list="area-suggestions"
        placeholder="Type or pick an area"
        className="w-full border rounded px-3 py-2 text-gray-900"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id="area-suggestions">
        {ALL_SUGGESTIONS.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
    </>
  );
}
