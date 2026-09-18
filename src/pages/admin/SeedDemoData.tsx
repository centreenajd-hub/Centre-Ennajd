import { useState } from "react";
import { Loader2, Sprout } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useEnnajdState } from "@/hooks/use-ennajd-state";
import { buildSeedPrices, buildSeedStudents, SEED_SESSIONS } from "@/lib/ennajd-seed-data";
import { showSuccess } from "@/utils/toast";

const STUDENT_COUNT = 300;
const CHUNK_SIZE = 20;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function SeedDemoData() {
  const students = useEnnajdState((s) => s.students);
  const sessions = useEnnajdState((s) => s.sessions);
  const prices = useEnnajdState((s) => s.prices);
  const addStudent = useEnnajdState((s) => s.addStudent);
  const addSession = useEnnajdState((s) => s.addSession);
  const setPrice = useEnnajdState((s) => s.setPrice);

  const [isSeeding, setIsSeeding] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleSeed() {
    setIsSeeding(true);
    setProgress(0);

    for (const session of SEED_SESSIONS) {
      addSession(session);
    }

    for (const price of buildSeedPrices()) {
      setPrice(price);
    }

    const seedStudents = buildSeedStudents(STUDENT_COUNT);
    for (let i = 0; i < seedStudents.length; i += CHUNK_SIZE) {
      const chunk = seedStudents.slice(i, i + CHUNK_SIZE);
      for (const student of chunk) {
        addStudent(student);
      }
      setProgress(Math.min(i + CHUNK_SIZE, seedStudents.length));
      await sleep(0);
    }

    setIsSeeding(false);
    showSuccess(
      `Seeded ${SEED_SESSIONS.length} sessions, ${buildSeedPrices().length} price entries, and ${STUDENT_COUNT} students ✅`,
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg rounded-2xl border-border/60 shadow-md">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sprout className="h-5 w-5" />
            </div>
            <CardTitle className="text-xl">Seed Demo Data</CardTitle>
          </div>
          <CardDescription>
            Adds 8 sample sessions, a full price matrix, and {STUDENT_COUNT} sample
            students to the shared database. Safe to run multiple times — it only
            adds, never deletes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-bold text-primary">{students.length}</p>
              <p className="text-xs text-muted-foreground">Students</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-bold text-primary">{sessions.length}</p>
              <p className="text-xs text-muted-foreground">Sessions</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-2xl font-bold text-primary">{prices.length}</p>
              <p className="text-xs text-muted-foreground">Prices</p>
            </div>
          </div>

          <Button
            onClick={handleSeed}
            disabled={isSeeding}
            className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            size="lg"
          >
            {isSeeding ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding students… {progress} / {STUDENT_COUNT}
              </>
            ) : (
              <>🌱 Seed Demo Data</>
            )}
          </Button>

          {isSeeding && (
            <Progress value={(progress / STUDENT_COUNT) * 100} className="h-2" />
          )}

          <div className="flex justify-center">
            <Badge
              variant="outline"
              className="rounded-full border-amber-400/60 bg-amber-400/10 text-amber-700"
            >
              Dev tool — keep this page unlisted
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
