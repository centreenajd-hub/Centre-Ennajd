// Pure, in-memory demo-data generator for the "Seed Demo Data" dev tool.
// Zero React/Zustand/Firebase imports — same convention as ennajd-taxonomy.ts.
// Every generated record is validated against the taxonomy rules so it can
// flow through the exact same store actions (addStudent/addSession/setPrice)
// a staff member would trigger by hand.

import {
  canSubjectBeSmallGroup,
  getPricableCombosForLevel,
  getPricableCombosForLevelTrack,
  getSubjectsFor,
  isCombinedClass,
  isGroupTypeApplicable,
  isTrackRequired,
  LEVELS,
  TRACKS,
} from "@/lib/ennajd-taxonomy";
import type {
  GroupType,
  Level,
  PriceEntry,
  Session,
  Student,
  Subject,
  SubjectEnrollment,
  Track,
} from "@/types/ennajd";

// --- Small deterministic RNG (mulberry32) — no external dependency. ---
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

// --- Name pools: Moroccan-realistic, mixed gender. ---
const MALE_FIRST_NAMES = [
  "Youssef", "Mohamed", "Ahmed", "Omar", "Yassine", "Anas", "Ayoub", "Hamza",
  "Ismail", "Zakaria", "Adam", "Rayan", "Amine", "Karim", "Bilal", "Soufiane",
  "Marouane", "Nabil", "Reda", "Othmane", "Walid", "Sami", "Mehdi", "Tarik",
  "Younes", "Hicham", "Adil", "Mounir", "Khalid", "Aymane",
];

const FEMALE_FIRST_NAMES = [
  "Fatima Zahra", "Sara", "Salma", "Meryem", "Yasmine", "Imane", "Nour",
  "Hiba", "Rania", "Khadija", "Aya", "Chaimae", "Ghita", "Kenza", "Malak",
  "Rim", "Douaa", "Ilham", "Basma", "Hind", "Lina", "Manal", "Asmaa",
  "Zineb", "Amina",
];

const LAST_NAMES = [
  "Alaoui", "Bennani", "El Fassi", "Chraibi", "Tazi", "Idrissi", "Bouzid",
  "El Amrani", "Ziani", "Chakir", "Berrada", "El Khatib", "Naciri", "Sbai",
  "Kabbaj", "Rhazi", "El Ouafi", "Benjelloun", "Tahiri", "Squalli",
  "Cherkaoui", "Amrani", "Bakkali", "El Mansouri", "Guennoun", "Lahlou",
  "Ouazzani", "Zerouali", "Belhaj", "Filali",
];

function randomPhone(rng: () => number): string {
  const prefix = rng() < 0.5 ? "06" : "07";
  let digits = "";
  for (let i = 0; i < 8; i++) digits += Math.floor(rng() * 10).toString();
  return prefix + digits;
}

// --- 8 hand-picked, taxonomy-valid sessions spanning all 6 levels. ---
export const SEED_SESSIONS: Omit<Session, "id">[] = [
  {
    subject: "Math",
    level: "T.C",
    track: null,
    groupType: null,
    dayOfWeek: 1, // Monday
    startTime: "15:00",
    endTime: "16:30",
    teacherName: "Prof. 1",
  },
  {
    subject: "Math",
    level: "1Bac",
    track: "s.x",
    groupType: null,
    dayOfWeek: 2, // Tuesday
    startTime: "16:00",
    endTime: "17:30",
    teacherName: "Prof. 2",
  },
  {
    subject: "French",
    level: "1Bac",
    track: "s.m",
    groupType: null,
    dayOfWeek: 2, // Tuesday
    startTime: "17:45",
    endTime: "19:15",
    teacherName: "Prof. 3",
  },
  {
    subject: "Math",
    level: "2Bac",
    track: "s.x",
    groupType: "Small",
    dayOfWeek: 3, // Wednesday
    startTime: "15:00",
    endTime: "16:30",
    teacherName: "Prof. 4",
  },
  {
    subject: "Philosophy",
    level: "2Bac",
    track: null, // combined class — shared across both tracks
    groupType: null,
    dayOfWeek: 3, // Wednesday
    startTime: "17:00",
    endTime: "18:00",
    teacherName: "Prof. 5",
  },
  {
    subject: "Math",
    level: "1Col",
    track: null,
    groupType: null,
    dayOfWeek: 4, // Thursday
    startTime: "14:30",
    endTime: "16:00",
    teacherName: "Prof. 6",
  },
  {
    subject: "SVT",
    level: "2Col",
    track: null,
    groupType: null,
    dayOfWeek: 4, // Thursday
    startTime: "16:15",
    endTime: "17:45",
    teacherName: "Prof. 7",
  },
  {
    subject: "Arabic",
    level: "3Col",
    track: null,
    groupType: null,
    dayOfWeek: 5, // Friday
    startTime: "14:30",
    endTime: "16:00",
    teacherName: "Prof. 8",
  },
];

// --- Price matrix: every combo the taxonomy considers priceable, at every level. ---
function priceRange(level: Level): [number, number] {
  if (level === "1Col" || level === "2Col" || level === "3Col") return [200, 350];
  return [300, 450]; // T.C, 1Bac, 2Bac (lycée)
}

function randomBasePrice(level: Level, rng: () => number): number {
  const [min, max] = priceRange(level);
  return Math.round((min + rng() * (max - min)) / 10) * 10;
}

export function buildSeedPrices(): Omit<PriceEntry, "id">[] {
  const rng = makeRng(42);
  const prices: Omit<PriceEntry, "id">[] = [];

  for (const level of LEVELS) {
    if (isTrackRequired(level)) {
      for (const track of TRACKS) {
        const combos = getPricableCombosForLevelTrack(level, track);
        let lastLargePrice: number | undefined;
        for (const combo of combos) {
          let price: number;
          if (combo.groupType === "Small" && lastLargePrice !== undefined) {
            price = Math.round((lastLargePrice * 1.2) / 10) * 10;
          } else {
            price = randomBasePrice(level, rng);
            if (combo.groupType === "Large") lastLargePrice = price;
          }
          prices.push({
            level,
            subject: combo.subject,
            track: combo.track,
            groupType: combo.groupType,
            price,
          });
        }
      }
    } else {
      const combos = getPricableCombosForLevel(level);
      let lastLargePrice: number | undefined;
      for (const combo of combos) {
        let price: number;
        if (combo.groupType === "Small" && lastLargePrice !== undefined) {
          price = Math.round((lastLargePrice * 1.2) / 10) * 10;
        } else {
          price = randomBasePrice(level, rng);
          if (combo.groupType === "Large") lastLargePrice = price;
        }
        prices.push({
          level,
          subject: combo.subject,
          track: null,
          groupType: combo.groupType,
          price,
        });
      }
    }
  }

  return prices;
}

// --- Student generation, distributed across the 8 seeded session combos. ---
interface SeedCombo {
  level: Level;
  track: Track | null;
  subject: Subject;
  groupType: GroupType | null;
}

const SEED_COMBOS: SeedCombo[] = [
  { level: "T.C", track: null, subject: "Math", groupType: null },
  { level: "1Bac", track: "s.x", subject: "Math", groupType: null },
  { level: "1Bac", track: "s.m", subject: "French", groupType: null },
  { level: "2Bac", track: "s.x", subject: "Math", groupType: "Small" },
  { level: "2Bac", track: null, subject: "Philosophy", groupType: null },
  { level: "1Col", track: null, subject: "Math", groupType: null },
  { level: "2Col", track: null, subject: "SVT", groupType: null },
  { level: "3Col", track: null, subject: "Arabic", groupType: null },
];

export function buildSeedStudents(count = 300): Omit<Student, "id" | "createdAt">[] {
  const rng = makeRng(7);
  const students: Omit<Student, "id" | "createdAt">[] = [];

  for (let i = 0; i < count; i++) {
    const combo = SEED_COMBOS[i % SEED_COMBOS.length];
    const isMale = rng() < 0.5;
    const firstName = pick(isMale ? MALE_FIRST_NAMES : FEMALE_FIRST_NAMES, rng);
    const lastName = pick(LAST_NAMES, rng);

    // Combined classes (Philosophy/English) have no track on the session,
    // but the student themself still belongs to a track when their level
    // requires one.
    const track: Track | null = isTrackRequired(combo.level)
      ? combo.track ?? (rng() < 0.5 ? "s.x" : "s.m")
      : null;

    const enrollments: SubjectEnrollment[] = [
      { subject: combo.subject, track: combo.track, groupType: combo.groupType },
    ];

    // ~30% of students get a second, taxonomy-valid enrollment.
    if (rng() < 0.3) {
      const candidateSubjects = getSubjectsFor(combo.level, track).filter(
        (subject) => subject !== combo.subject,
      );
      if (candidateSubjects.length > 0) {
        const secondSubject = pick(candidateSubjects, rng);
                const combined = isCombinedClass(combo.level, secondSubject);
                const groupTypeApplicable = isGroupTypeApplicable(combo.level, secondSubject);
                const smallAllowed = canSubjectBeSmallGroup(combo.level, track, secondSubject);
                const secondGroupType: GroupType | null = groupTypeApplicable
                  ? rng() < 0.5 && smallAllowed
                    ? "Small"
                    : "Large"
                  : null;
        enrollments.push({
          subject: secondSubject,
          track: combined ? null : track,
          groupType: secondGroupType,
        });
      }
    }

    const whatsappPhone = randomPhone(rng);
    let parentPhone = randomPhone(rng);
    while (parentPhone === whatsappPhone) parentPhone = randomPhone(rng);

    students.push({
      firstName,
      lastName,
      whatsappPhone,
      parentPhone,
      level: combo.level,
      track,
      enrollments,
    });
  }

  return students;
}
