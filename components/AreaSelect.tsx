'use client';

// Kannur revenue villages (source: Wikipedia, "Political divisions of
// Kannur district" — this is where the business actually operates, so it
// gets full village-level detail, taluk by taluk).
const KANNUR_VILLAGES: Record<string, string[]> = {
  'Kannur Taluk': [
    'Anjarakandi', 'Azhikode North', 'Azhikode South', 'Chelora', 'Chembilode', 'Cherukkunnu',
    'Chirakkal', 'Edakkad', 'Elayavoor', 'Iriveri', 'Kadambur', 'Kalliasseri', 'Kanhirod',
    'Kannadiparamba', 'Kannapuram', 'Kannur-1', 'Kannur-2', 'Makrery', 'Mattool', 'Mavilayi',
    'Munderi', 'Muzhappilangad', 'Narath', 'Pallikkunnu', 'Pappinisseri', 'Puzhathi',
    'Valapattanam', 'Valiyannur',
  ],
  'Thalassery Taluk': [
    'Cheruvanchery', 'Chokli', 'Dharmadam', 'Erancholi', 'Eruvatty', 'Kadirur', 'Kandankunnu',
    'Kannavam', 'Keezhallur', 'Kodiyeri', 'Kolavallur', 'Kolayad', 'Koodali', 'Kottayam',
    'Kuthuparamba', 'Mananthery', 'Mangattidam', 'Mokery', 'New Mahe', 'Paduvilayi',
    'Panniyannur', 'Panoor', 'Pathiriyad', 'Pattanur', 'Pattiam', 'Peringalam', 'Peringathur',
    'Pinarayi', 'Puthur', 'Shivapuram', 'Thalassery', 'Thiruvangad', 'Tholambra',
    'Thripangothur', 'Vekkalam',
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
    <select
      required={required}
      className="w-full border rounded px-3 py-2 text-gray-900"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select area</option>
      {Object.entries(KANNUR_VILLAGES).map(([taluk, villages]) => (
        <optgroup key={taluk} label={`Kannur — ${taluk}`}>
          {villages.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </optgroup>
      ))}
      {Object.entries(NEIGHBORING_DISTRICT_TALUKS).map(([district, taluks]) => (
        <optgroup key={district} label={district}>
          {taluks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      ))}
      <optgroup label="Other Kerala Districts">
        {OTHER_KERALA_DISTRICTS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </optgroup>
    </select>
  );
}
