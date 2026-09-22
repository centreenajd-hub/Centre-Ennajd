// Unified PDF report engine for the Report Generator — built on
// @react-pdf/renderer with classic black & white design.
// Reports are always in French regardless of UI language.

import type { ReactNode } from "react";

import { Document, Font, Image, Page, StyleSheet, Text, View, pdf } from "@react-pdf/renderer";

import {
  buildAttendanceMatrix,
  type AttendanceMatrix,
  type AttendanceMatrixRow,
} from "@/lib/ennajd-attendance-report";
import { formatDateKey } from "@/lib/ennajd-billing";
import { buildPaymentMatrix, type PaymentMatrixRow } from "@/lib/ennajd-payment-report";
import type { SessionScope } from "@/lib/ennajd-report-scope";
import {
  ATTENDANCE_ROWS_PER_PAGE,
  REPORT_ROWS_PER_PAGE,
  chunkRows,
  getAcademicYearMonths,
  type AcademicMonth,
} from "@/lib/ennajd-report-shared";
import { getEnrolledStudentsForCombo } from "@/lib/ennajd-taxonomy";
import type { DictKey, LangCode } from "@/lib/i18n";
import type {
  AttendanceRecord,
  GroupType,
  Level,
  Payment,
  PriceEntry,
  Session,
  Student,
  Subject,
  Track,
} from "@/types/ennajd";

// Register Helvetica as the primary font for classic B&W reports
Font.register({
  family: "Helvetica",
  fonts: [
    { src: "Helvetica", fontWeight: 400 },
    { src: "Helvetica-Bold", fontWeight: 600 },
    { src: "Helvetica-Bold", fontWeight: 700 },
  ],
});

// Classic Black & White palette
const BW_PALETTE = {
  white: "#ffffff",
  black: "#000000",
  green: "#1e9e50", // For PAIEMENT column only
  red: "#b00020", // Unpaid / complement badges only
  gray: "#666666",
  lightGray: "#cccccc",
};

// Styles for the classic B&W reports
const reportStyles = StyleSheet.create({
  // Base page style for reports (always French, LTR, Helvetica)
  reportPage: {
    fontFamily: "Helvetica",
    fontSize: 8,
    padding: 20,
    backgroundColor: BW_PALETTE.white,
    color: BW_PALETTE.black,
  },

  // Attendance report specific page (landscape)
  attendancePage: {
    fontFamily: "Helvetica",
    fontSize: 8,
    padding: 20,
    backgroundColor: BW_PALETTE.white,
    color: BW_PALETTE.black,
  },

  // Payments report specific page (portrait)
  paymentsPage: {
    fontFamily: "Helvetica",
    fontSize: 8,
    padding: 20,
    backgroundColor: BW_PALETTE.white,
    color: BW_PALETTE.black,
  },

  // Header styles
  mainTitle: {
    fontSize: 14,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 10,
  },

  infoLine: {
    fontSize: 8,
    marginBottom: 2,
  },

  infoLabel: {
    fontWeight: 600,
  },

  infoContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  leftInfo: {
    flexDirection: "column",
  },

  rightInfo: {
    flexDirection: "column",
    alignItems: "flex-end",
  },

  // Table styles
  table: {
    borderWidth: 0.5,
    borderColor: BW_PALETTE.black,
  },

  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: BW_PALETTE.black,
    // Print hygiene: never split a student row across a page bottom.
    breakInside: "avoid",
  },

  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: BW_PALETTE.black,
  },

  tableCell: {
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  nameCell: {
    width: 110,
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    justifyContent: "center",
  },

  dayCell: {
    width: 18,
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  totCell: {
    width: 25,
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  paymentCell: {
    width: 30,
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRightWidth: 0,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  // Header cells
  headerCell: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
  },

  nameHeaderCell: {
    width: 110,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
  },

  dayHeaderCell: {
    width: 18,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
  },

  totHeaderCell: {
    width: 25,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
  },

  paymentHeaderCell: {
    width: 30,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
  },

  // Text styles
  headerText: {
    fontSize: 7.5,
    fontWeight: 700,
    textAlign: "center",
  },

  nameHeaderText: {
    fontSize: 8,
    fontWeight: 700,
    textAlign: "center",
  },

  bodyText: {
    fontSize: 8,
    textAlign: "center",
  },

  nameText: {
    fontSize: 8,
    fontWeight: 600,
  },

  markPresent: {
    fontSize: 8,
    fontWeight: 700,
  },

  markAbsent: {
    fontSize: 8,
    fontWeight: 700,
  },

  markEmpty: {
    fontSize: 8,
  },

  paymentMark: {
    fontSize: 8,
    fontWeight: 700,
    color: BW_PALETTE.green,
  },

  // Total row styles
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 0.5,
    borderColor: BW_PALETTE.black,
  },

  totalNameCell: {
    width: 110,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    justifyContent: "center",
  },

  totalCell: {
    width: 18,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  totalTotCell: {
    width: 25,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  totalPaymentCell: {
    width: 30,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
  },

  totalText: {
    fontSize: 8.5,
    fontWeight: 700,
  },

  totalCellText: {
    fontSize: 8,
    fontWeight: 700,
    textAlign: "center",
  },

  // Page number footer pinned to the bottom of every attendance page
  attendanceFooter: {
    position: "absolute",
    bottom: 10,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "center",
  },

  // Page number footer for payments report
  pageNumberContainer: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 10,
  },

  pageNumberText: {
    fontSize: 7,
    color: BW_PALETTE.gray,
  },

  // Payments report specific styles
  paymentsNameCell: {
    width: 90,
    paddingVertical: 3,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    justifyContent: "center",
  },

  paymentsHeaderCell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
    minWidth: 25,
  },

  paymentsBodyCell: {
    flex: 1,
    paddingVertical: 3,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 25,
  },

  paymentsNameHeaderCell: {
    width: 90,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    justifyContent: "center",
    backgroundColor: BW_PALETTE.white,
  },

  paymentsTotalNameCell: {
    width: 90,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    justifyContent: "center",
  },

  paymentsTotalCell: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRightWidth: 0.5,
    borderColor: BW_PALETTE.black,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 25,
  },

  paymentsHeaderText: {
    fontSize: 6.5,
    fontWeight: 600,
    textAlign: "center",
  },

  paymentsNameHeaderText: {
    fontSize: 7.5,
    fontWeight: 700,
    textAlign: "center",
  },

  paymentsBodyText: {
    fontSize: 7.5,
    textAlign: "center",
  },

  paymentsNameText: {
    fontSize: 8,
    fontWeight: 600,
  },

  paymentsAmountText: {
    fontSize: 7.5,
    fontWeight: 700,
    textAlign: "center",
  },

  // Unpaid month's monthly fee — same weight as a paid amount, red so the
  // complement owed is never mistaken for settled.
  paymentsAmountUnpaid: {
    fontSize: 7.5,
    fontWeight: 700,
    textAlign: "center",
    color: BW_PALETTE.red,
  },

  // "Payé" badge under a settled month's amount.
  paymentsBadgePaid: {
    fontSize: 5.5,
    fontWeight: 700,
    textAlign: "center",
    color: BW_PALETTE.green,
  },

  // "Impayée" badge under an unsettled month's amount.
  paymentsBadgeUnpaid: {
    fontSize: 5.5,
    fontWeight: 700,
    textAlign: "center",
    color: BW_PALETTE.red,
  },

  // Complement line: "Reste X" under a partially-paid month's credit.
  paymentsRemaining: {
    fontSize: 5.5,
    fontWeight: 600,
    textAlign: "center",
    color: BW_PALETTE.gray,
  },

  paymentsDash: {
    fontSize: 7.5,
    textAlign: "center",
  },

  // Legend under the payments table explaining the per-cell badges.
  legendContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },

  legendText: {
    fontSize: 6,
    color: BW_PALETTE.gray,
    marginRight: 6,
  },

  // Grand total row
  grandTotalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 0.5,
    borderColor: BW_PALETTE.black,
  },

  grandTotalText: {
    fontSize: 8.5,
    fontWeight: 700,
  },

  grandTotalCellText: {
    fontSize: 8,
    fontWeight: 700,
    textAlign: "center",
  },
});

// Keep the original styles for receipts (unchanged)
const receiptStyles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    padding: 20,
    paddingBottom: 58,
    backgroundColor: "#e9f1ef",
    color: "#1e2929",
  },

  headerCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d7e0de",
    alignItems: "center",
    paddingVertical: 9,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  logo: { width: 40, height: 40, marginBottom: 4 },
  headerAppName: { fontSize: 14, fontWeight: 700, color: "#1d726f" },
  headerClassLine: { fontSize: 9, color: "#1e2929", marginTop: 2 },
  headerSectionTitle: { fontSize: 11.5, fontWeight: 700, color: "#14524f", marginTop: 2 },
  headerDivider: {
    flexDirection: "row",
    width: 240,
    height: 3,
    borderRadius: 1.5,
    overflow: "hidden",
    marginTop: 7,
  },
  headerDividerSide: { flex: 1, backgroundColor: "#1d726f" },
  headerDividerAccent: { width: 60, backgroundColor: "#e9a617" },
  generatedLine: { fontSize: 8, color: "#7a8886", marginTop: 6 },

  tableCard: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d7e0de",
    overflow: "hidden",
  },
  headerRow: { flexDirection: "row", backgroundColor: "#1d726f" },
  headerAccentStrip: { height: 2.5, backgroundColor: "#e9a617" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: "#d7e0de" },
  zebraRow: { backgroundColor: "#f6faf9" },
  nameCell: {
    width: 110,
    paddingVertical: 3,
    paddingHorizontal: 6,
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderColor: "#d7e0de",
  },
  headerCell: {
    flex: 1,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderColor: "#3f8785",
  },
  headerCellText: { color: "#ffffff", fontSize: 7.5, fontWeight: 600, textAlign: "center" },
  nameHeaderText: { color: "#ffffff", fontSize: 8, fontWeight: 700 },
  bodyCell: {
    flex: 1,
    paddingVertical: 3,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderColor: "#d7e0de",
  },
  nameText: { fontSize: 8.5, fontWeight: 600 },
  markPresent: { fontSize: 8, fontWeight: 700, color: "#1e9e50" },
  markAbsent: { fontSize: 8, fontWeight: 700, color: "#dc2828" },
  markMuted: { fontSize: 8, color: "#7a8886" },
  timestampText: { fontSize: 6, color: "#7a8886", marginTop: 1 },
  amountPaid: { fontSize: 8, fontWeight: 700, color: "#1e9e50" },
  amountUnpaid: { fontSize: 8, fontWeight: 700, color: "#dc2828" },
  totalRow: {
    flexDirection: "row",
    backgroundColor: "#e0edeb",
    borderTopWidth: 1,
    borderColor: "#1d726f",
  },
  totalNameCell: {
    width: 110,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRightWidth: 0.5,
    borderColor: "#d7e0de",
  },
  totalText: { fontSize: 8.5, fontWeight: 700, color: "#14524f" },
  totalCellText: { fontSize: 8, fontWeight: 700, color: "#14524f", textAlign: "center" },

  portraitNameCell: {
    width: 90,
    paddingVertical: 3.5,
    paddingHorizontal: 4,
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderColor: "#d7e0de",
  },
  portraitTotalNameCell: {
    width: 90,
    paddingVertical: 4.5,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderColor: "#d7e0de",
  },
  portraitNameText: { fontSize: 8, fontWeight: 600 },
  portraitNameHeaderText: { color: "#ffffff", fontSize: 7.5, fontWeight: 700 },
  portraitHeaderCellText: { color: "#ffffff", fontSize: 6.5, fontWeight: 600, textAlign: "center" },
  portraitAmountPaid: { fontSize: 7.5, fontWeight: 700, color: "#1e9e50" },
  portraitAmountUnpaid: { fontSize: 7.5, fontWeight: 700, color: "#dc2828" },
  portraitTimestampText: { fontSize: 5.5, color: "#7a8886", marginTop: 1 },
  portraitTotalCellText: { fontSize: 7.5, fontWeight: 700, color: "#14524f", textAlign: "center" },

  footerBlock: {
    position: "absolute",
    bottom: 16,
    left: 20,
    right: 20,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e0de",
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerItem: { width: 170, alignItems: "center" },
  footerLine: { borderTopWidth: 0.75, borderColor: "#1d726f", width: "100%", marginBottom: 4 },
  footerLabel: { fontSize: 8, fontWeight: 600, color: "#1d726f" },

  statsRow: { flexDirection: "row", marginTop: 12 },
  statBox: {
    flex: 1,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e0de",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    marginHorizontal: 4,
  },
  statValue: { fontSize: 16, fontWeight: 700, color: "#1d726f" },
  statLabel: { fontSize: 7.5, color: "#7a8886", marginTop: 4, textAlign: "center" },

  receiptInfoBlock: {
    marginTop: 4,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d7e0de",
    borderRadius: 10,
    padding: 10,
  },
  receiptInfoRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  receiptInfoLabel: { fontSize: 8, color: "#7a8886" },
  receiptInfoValue: { fontSize: 9.5, fontWeight: 700 },
  receiptMonthLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#14524f",
    marginTop: 12,
    marginBottom: 4,
    textAlign: "center",
  },
  receiptSectionLabel: { fontSize: 9, fontWeight: 700, color: "#1d726f", marginTop: 12, marginBottom: 4 },
  receiptHeaderCell: {
    flex: 1,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderColor: "#3f8785",
  },
  receiptBodyCell: {
    flex: 1,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 0.5,
    borderColor: "#d7e0de",
  },
  receiptCellText: { fontSize: 8, textAlign: "center" },
  amountPartiallyPaid: { fontSize: 8, fontWeight: 700, color: "#e9a617" },
  receiptTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#e0edeb",
    borderWidth: 1,
    borderColor: "#d7e0de",
    borderRadius: 8,
    marginTop: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  receiptTotalLabel: { fontSize: 9.5, fontWeight: 700, color: "#14524f" },
  receiptTotalValue: { fontSize: 11.5, fontWeight: 700, color: "#14524f" },
});

function formatClassLine(
  subject: Subject,
  level: Level,
  track: Track | null,
  groupType: GroupType | null,
  t: (key: DictKey) => string,
): string {
  const groupLabel = groupType ? (groupType === "Small" ? t("small") : t("large")) : null;
  return [subject, level, track, groupLabel].filter(Boolean).join(" · ");
}

function ReportHeader({ appName, classLine, sectionTitle, generatedOn, logoSrc }: {
  appName: string;
  classLine: string;
  sectionTitle: string;
  generatedOn: string;
  logoSrc?: string;
}) {
  return (
    <View style={receiptStyles.headerCard}>
      {logoSrc && <Image style={receiptStyles.logo} src={logoSrc} />}
      <Text style={receiptStyles.headerAppName}>{appName}</Text>
      <Text style={receiptStyles.headerClassLine}>{classLine}</Text>
      <Text style={receiptStyles.headerSectionTitle}>{sectionTitle}</Text>
      <View style={receiptStyles.headerDivider}>
        <View style={receiptStyles.headerDividerSide} />
        <View style={receiptStyles.headerDividerAccent} />
        <View style={receiptStyles.headerDividerSide} />
      </View>
      <Text style={receiptStyles.generatedLine}>{generatedOn}</Text>
    </View>
  );
}

function ReportFooter({ rtl, t }: { rtl: boolean; t: (key: DictKey) => string }) {
  return (
    <View style={[receiptStyles.footerBlock, rtl ? { flexDirection: "row-reverse" } : {}]} fixed>
      <View style={receiptStyles.footerItem}>
        <View style={receiptStyles.footerLine} />
        <Text style={receiptStyles.footerLabel}>{t("signatureLabel")}</Text>
      </View>
      <View style={receiptStyles.footerItem}>
        <View style={receiptStyles.footerLine} />
        <Text style={receiptStyles.footerLabel}>{t("stampLabel")}</Text>
      </View>
    </View>
  );
}

function AttendancePage({
  chunk,
  dates,
  monthKey,
  sessions,
  payments,
  subject,
  level,
  track,
  groupType,
  appName,
  pageNumber,
  totalPages,
}: {
  chunk: AttendanceMatrixRow[];
  dates: string[];
  monthKey: string;
  sessions: Session[];
  payments: Payment[];
  subject: Subject;
  level: Level;
  track: Track | null;
  groupType: GroupType | null;
  appName: string;
  pageNumber: number;
  totalPages: number;
}) {
  const [year, month] = monthKey.split("-").map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
  }).toUpperCase();

  // Get teacher name from sessions
  const teacherName = sessions.length > 0 ? sessions[0].teacherName : undefined;

  // Calculate TOT for each student
  const getStudentTot = (row: AttendanceMatrixRow): number => {
    let count = 0;
    for (const cell of row.cellsByDate.values()) {
      if (cell.status === "present") count++;
    }
    return count;
  };

  // Check if student paid for this month
  const isStudentPaidForMonth = (studentId: string): boolean => {
    return payments.some(
      (p) => p.studentId === studentId && p.month === monthKey && p.isPaid,
    );
  };

  return (
    <Page size="A4" orientation="landscape" style={reportStyles.attendancePage}>
      {/* Main title */}
      <Text style={reportStyles.mainTitle}>FEUILLE DE PRÉSENCE MENSUELLE</Text>

      {/* Info lines */}
      <View style={reportStyles.infoContainer}>
        <View style={reportStyles.leftInfo}>
          <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
            MATIERE : {subject}
          </Text>
          <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
            NIVEAU : {level}
          </Text>
          <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
            MOIS : {monthName}
          </Text>
        </View>
        <View style={reportStyles.rightInfo}>
          <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
            PROF : {teacherName || ""}
          </Text>
        </View>
      </View>

      {/* Table */}
      <View style={reportStyles.table}>
        {/* Header row */}
        <View style={[reportStyles.tableHeaderRow]}>
          <View style={reportStyles.nameHeaderCell}>
            <Text style={reportStyles.nameHeaderText}>NOM ET PRENOM</Text>
          </View>
          {dates.map((date, index) => {
            const day = new Date(date).getDate();
            return (
              <View key={date} style={reportStyles.dayHeaderCell}>
                <Text style={reportStyles.headerText}>{day}</Text>
              </View>
            );
          })}
          <View style={reportStyles.totHeaderCell}>
            <Text style={reportStyles.headerText}>TOT</Text>
          </View>
          <View style={reportStyles.paymentHeaderCell}>
            <Text style={reportStyles.headerText}>PAIEMENT</Text>
          </View>
        </View>

        {/* Data rows */}
        {chunk.map((row, rowIdx) => {
          const tot = getStudentTot(row);
          const isPaid = isStudentPaidForMonth(row.student.id);

          return (
            <View key={row.student.id} style={reportStyles.tableRow}>
              <View style={reportStyles.nameCell}>
                <Text style={reportStyles.nameText}>
                  {row.student.lastName} {row.student.firstName}
                </Text>
              </View>
              {dates.map((date) => {
                const cell = row.cellsByDate.get(date);
                if (!cell || cell.status === "not-occurred") {
                  return (
                    <View key={date} style={reportStyles.dayCell}>
                      <Text style={reportStyles.markEmpty}></Text>
                    </View>
                  );
                }
                const isPresent = cell.status === "present";
                return (
                  <View key={date} style={reportStyles.dayCell}>
                    <Text style={isPresent ? reportStyles.markPresent : reportStyles.markAbsent}>
                      {isPresent ? "P" : "A"}
                    </Text>
                  </View>
                );
              })}
              <View style={reportStyles.totCell}>
                <Text style={reportStyles.bodyText}>{tot}</Text>
              </View>
              <View style={reportStyles.paymentCell}>
                <Text style={reportStyles.paymentMark}>
                  {isPaid ? `MOIS ${month}` : ""}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {/* Page number footer */}
      <View style={reportStyles.attendanceFooter}>
        <Text style={reportStyles.pageNumberText}>
          Page {pageNumber}/{totalPages}
        </Text>
      </View>
    </Page>
  );
}

function PaymentsPage({
  chunk,
  months,
  subject,
  level,
  track,
  groupType,
  appName,
  isLastChunk,
  totalsByMonth,
  pageNumber,
  totalPages,
  t,
}: {
  chunk: PaymentMatrixRow[];
  months: AcademicMonth[];
  subject: Subject;
  level: Level;
  track: Track | null;
  groupType: GroupType | null;
  appName: string;
  isLastChunk: boolean;
  totalsByMonth: Map<string, number>;
  pageNumber: number;
  totalPages: number;
  t: (key: DictKey) => string;
}) {
  // Calculate academic year
  const yearLabel = `${months[0].year}-${months[months.length - 1].year}`;

  // Calculate totals for each row — fully-paid months count at full amount;
  // partial months count only what was actually covered (amountPaid).
  const getRowTotal = (row: PaymentMatrixRow): number => {
    let total = 0;
    for (const cell of row.cellsByMonth.values()) {
      if (cell && cell.isPaid) {
        total += cell.amountDue;
      } else if (cell && cell.isPartiallyPaid) {
        total += cell.amountPaid;
      }
    }
    return total;
  };

  // Calculate grand totals
  const grandTotals: number[] = [];
  for (const month of months) {
    grandTotals.push(totalsByMonth.get(month.key) ?? 0);
  }

  // Calculate overall grand total
  const overallGrandTotal = grandTotals.reduce((sum, val) => sum + val, 0);

  return (
    <Page size="A4" style={reportStyles.paymentsPage}>
      {/* Page number */}
      <View style={reportStyles.pageNumberContainer}>
        <Text style={reportStyles.pageNumberText}>
          Centre Ennajd - Page {pageNumber}/{totalPages}
        </Text>
      </View>

      {/* Main title */}
      <Text style={reportStyles.mainTitle}>TABLEAU DES PAIEMENTS MENSUELS</Text>

      {/* Info lines */}
      <View style={reportStyles.leftInfo}>
        <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
          MATIERE : {subject}
        </Text>
        <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
          NIVEAU : {level}
        </Text>
        <Text style={[reportStyles.infoLine, reportStyles.infoLabel]}>
          ANNEE : {yearLabel}
        </Text>
      </View>

      {/* Table */}
      <View style={reportStyles.table}>
        {/* Header row */}
        <View style={[reportStyles.tableHeaderRow]}>
          <View style={reportStyles.paymentsNameHeaderCell}>
            <Text style={reportStyles.paymentsNameHeaderText}>NOM ET PRENOM</Text>
          </View>
          {months.map((month) => {
            const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
            const monthIndex = month.monthIndex0; // 0-11
            return (
              <View key={month.key} style={reportStyles.paymentsHeaderCell}>
                <Text style={reportStyles.paymentsHeaderText}>
                  {monthNames[monthIndex]}
                </Text>
              </View>
            );
          })}
          <View style={reportStyles.paymentsHeaderCell}>
            <Text style={reportStyles.paymentsHeaderText}>TOTAL</Text>
          </View>
        </View>

        {/* Data rows */}
        {chunk.map((row, rowIdx) => {
          const rowTotal = getRowTotal(row);

          return (
            <View key={row.student.id} style={reportStyles.tableRow}>
              <View style={reportStyles.paymentsNameCell}>
                <Text style={reportStyles.paymentsNameText}>
                  {row.student.lastName} {row.student.firstName}
                </Text>
              </View>
              {months.map((month) => {
                const cell = row.cellsByMonth.get(month.key);
                if (!cell) {
                  return (
                    <View key={month.key} style={reportStyles.paymentsBodyCell}>
                      <Text style={reportStyles.paymentsDash}>-</Text>
                    </View>
                  );
                }
                if (cell.isPaid) {
                  return (
                    <View key={month.key} style={reportStyles.paymentsBodyCell}>
                      <Text style={reportStyles.paymentsAmountText}>{cell.amountDue}</Text>
                      <Text style={reportStyles.paymentsBadgePaid}>{t("paid")}</Text>
                    </View>
                  );
                }
                if (cell.isPartiallyPaid) {
                  // Partial months show the credit already carried plus the
                  // remaining complement, so a partially-paid month is never
                  // mistaken for a fully paid one in the printed matrix.
                  return (
                    <View key={month.key} style={reportStyles.paymentsBodyCell}>
                      <Text style={reportStyles.paymentsAmountText}>{cell.amountPaid}</Text>
                      <Text style={reportStyles.paymentsRemaining}>
                        {t("remainingAmount")} {cell.remaining}
                      </Text>
                    </View>
                  );
                }
                // UNPAID — the screen renders amountDue in red for this same
                // cell. The PDF must show the monthly fee and its unsettled
                // status too: the complement owed IS the amount here, so a
                // bare dash would silently drop the debt from the report.
                return (
                  <View key={month.key} style={reportStyles.paymentsBodyCell}>
                    <Text style={reportStyles.paymentsAmountUnpaid}>{cell.amountDue}</Text>
                    <Text style={reportStyles.paymentsBadgeUnpaid}>
                      {t("remainingAmount")} {cell.remaining}
                    </Text>
                  </View>
                );
              })}
              <View style={reportStyles.paymentsBodyCell}>
                <Text style={reportStyles.paymentsAmountText}>{rowTotal}</Text>
              </View>
            </View>
          );
        })}

        {/* Total row */}
        {isLastChunk && (
          <View style={reportStyles.totalRow}>
            <View style={reportStyles.paymentsTotalNameCell}>
              <Text style={reportStyles.totalText}>TOTAL GENERAL</Text>
            </View>
            {months.map((month, idx) => (
              <View key={month.key} style={reportStyles.paymentsTotalCell}>
                <Text style={reportStyles.totalCellText}>{grandTotals[idx]}</Text>
              </View>
            ))}
            <View style={reportStyles.paymentsTotalCell}>
              <Text style={reportStyles.totalCellText}>{overallGrandTotal}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Legend */}
      <View style={reportStyles.legendContainer}>
        <Text style={reportStyles.legendText}>{t("legendMonthlyFee")}</Text>
        <Text style={[reportStyles.legendText, { color: BW_PALETTE.green }]}>
          {t("paid")} : {t("legendPaid")}
        </Text>
        <Text style={reportStyles.legendText}>
          {t("remainingAmount")} : {t("legendRemaining")}
        </Text>
        <Text style={[reportStyles.legendText, { color: BW_PALETTE.red }]}>
          {t("unpaid")} : {t("legendUnpaid")}
        </Text>
      </View>
    </Page>
  );
}

export interface RenderReportOptions {
  sessions: Session[];
  level: Level;
  track: Track | null;
  groupType: GroupType | null;
  subject: Subject;
  monthKey: string;
  reportTypes: Array<"attendance" | "payments">;
  students: Student[];
  attendanceRecords: AttendanceRecord[];
  payments: Payment[];
  basePrice?: number;
  /** The price table — resolves each student's own monthly price (customPrice
   *  wins) so the Month-2 carryover credit is never a hardcoded number. */
  prices?: PriceEntry[];
  lang: LangCode;
  t: (key: DictKey) => string;
  appName: string;
  logoSrc?: string;
}

function EnnajdReportDocument({ options }: { options: RenderReportOptions }) {
  const { lang, t, monthKey, reportTypes } = options;
  const now = new Date();
  const todayKey = formatDateKey(now);
  const classLine = formatClassLine(options.subject, options.level, options.track, options.groupType, t);
  const generatedOn = now.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  const generatedOnLine = `Généré le : ${generatedOn}`;
  const nameColumnLabel = `${t("firstName")} / ${t("lastName")}`;

  const pages: ReactNode[] = [];

  if (reportTypes.includes("attendance")) {
    const matrix: AttendanceMatrix = buildAttendanceMatrix(
      options.sessions,
      { level: options.level, subject: options.subject, track: options.track, groupType: options.groupType },
      monthKey,
      options.students,
      options.attendanceRecords,
      todayKey,
    );
    const [year, month] = monthKey.split("-").map(Number);
    const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    const chunks = chunkRows(matrix.rows, ATTENDANCE_ROWS_PER_PAGE);
    const pageChunks: typeof chunks = chunks.length > 0 ? chunks : [[]];
    pageChunks.forEach((chunk, idx) => {
      pages.push(
        <AttendancePage
          key={`attendance-${idx}`}
          chunk={chunk}
          dates={matrix.dates}
          monthKey={monthKey}
          sessions={options.sessions}
          payments={options.payments}
          subject={options.subject}
          level={options.level}
          track={options.track}
          groupType={options.groupType}
          appName={options.appName}
          pageNumber={idx + 1}
          totalPages={pageChunks.length}
        />,
      );
    });
  }

  if (reportTypes.includes("payments")) {
    const months = getAcademicYearMonths(monthKey);
    const roster = getEnrolledStudentsForCombo(options.students, {
      level: options.level,
      subject: options.subject,
      track: options.track,
      groupType: options.groupType,
    });
    const matrix = buildPaymentMatrix(roster, options.payments, options.subject, months, options.basePrice, options.sessions, options.attendanceRecords, todayKey, options.prices ?? []);
    const yearLabel = `${months[0].year}-${months[months.length - 1].year}`;
    const chunks = chunkRows(matrix.rows, REPORT_ROWS_PER_PAGE);
    const pageChunks: typeof chunks = chunks.length > 0 ? chunks : [[]];
    pageChunks.forEach((chunk, idx) => {
      pages.push(
        <PaymentsPage
          key={`payments-${idx}`}
          chunk={chunk}
          months={matrix.months}
          subject={options.subject}
          level={options.level}
          track={options.track}
          groupType={options.groupType}
          appName={options.appName}
          isLastChunk={idx === pageChunks.length - 1}
          totalsByMonth={matrix.totalsByMonth}
          pageNumber={idx + 1}
          totalPages={pageChunks.length}
          t={t}
        />,
      );
    });
  }

  return <Document>{pages}</Document>;
}

export interface RenderReportResult {
  /** True if the font failed to load and the PDF fell back to the default font. */
  fontDegraded: boolean;
}

/** Builds, renders and downloads the unified attendance/payments PDF. */
export async function renderEnnajdReportPdf(
  options: RenderReportOptions,
): Promise<RenderReportResult> {
  const instance = pdf(<EnnajdReportDocument options={options} />);
  const blob = await instance.toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const trackPart = options.track ? `_${options.track}` : "";
  const groupPart = options.groupType ? `_${options.groupType}` : "";
  const fileSafeSubject = options.subject.replace(/\s+/g, "_");
  link.href = url;
  link.download = `rapport_${options.level}_${fileSafeSubject}${trackPart}${groupPart}_${options.monthKey}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { fontDegraded: false };
}

// --- Individual Student Receipt -------------------------------------------

export interface RenderStudentReceiptOptions {
  student: Student;
  subject: Subject;
  monthKey: string; // "YYYY-MM"
  payments: Payment[];
  attendanceRecords: AttendanceRecord[];
  sessions: Session[];
  level: Level;
  track: Track | null;
  groupType: GroupType | null;
  appName: string;
  lang: LangCode;
  t: (key: DictKey) => string;
  logoSrc?: string;
}

function StudentReceiptDocument({ options }: { options: RenderStudentReceiptOptions }) {
  const { lang, t, monthKey } = options;
  const locale = lang === "ar" ? "ar" : "fr-FR";
  const rtl = lang === "ar";
  const now = new Date();
  const todayKey = formatDateKey(now);
  const classLine = formatClassLine(options.subject, options.level, options.track, options.groupType, t);
  const generatedOn = now.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
  const generatedOnLine = `${rtl ? "تم الإنشاء في" : "Généré le"} : ${generatedOn}`;

  const [year, month] = monthKey.split("-").map(Number);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });

  const scope: SessionScope = {
    level: options.level,
    subject: options.subject,
    track: options.track,
    groupType: options.groupType,
  };
  const attendanceMatrix = buildAttendanceMatrix(
    options.sessions,
    scope,
    monthKey,
    [options.student],
    options.attendanceRecords,
    todayKey,
  );
  const attendanceRow = attendanceMatrix.rows.find((row) => row.student.id === options.student.id);
  let sessionsDelivered = 0;
  let presentCount = 0;
  let absentCount = 0;
  if (attendanceRow) {
    for (const cell of attendanceRow.cellsByDate.values()) {
      if (cell.status === "not-occurred") continue;
      sessionsDelivered++;
      if (cell.status === "present") presentCount++;
      else absentCount++;
    }
  }
  const attendanceRatePct = sessionsDelivered > 0 ? Math.round((presentCount / sessionsDelivered) * 100) : 0;

  const installments = options.payments
    .filter(
      (p) =>
        p.studentId === options.student.id && p.subject === options.subject && p.month === monthKey,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const totalAmount = installments.reduce((sum, p) => sum + p.amountDue, 0);
  const totalPaid = installments.reduce(
    (sum, p) => sum + (p.isPaid ? p.amountDue : Math.min(p.amountDue, p.amountPaid ?? 0)),
    0,
  );
  const totalRemaining = Math.max(0, totalAmount - totalPaid);

  const groupLabel = options.groupType
    ? options.groupType === "Small"
      ? t("small")
      : t("large")
    : "—";

  return (
    <Document>
      <Page size="A4" style={receiptStyles.page}>
        <ReportHeader
          appName={options.appName}
          classLine={classLine}
          sectionTitle={t("receiptTitle")}
          generatedOn={generatedOnLine}
          logoSrc={options.logoSrc}
        />

        <View style={receiptStyles.receiptInfoBlock}>
          <View style={[receiptStyles.receiptInfoRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
            <Text style={receiptStyles.receiptInfoLabel}>{t("fullName")}</Text>
            <Text style={receiptStyles.receiptInfoValue}>
              {options.student.firstName} {options.student.lastName}
            </Text>
          </View>
          <View style={[receiptStyles.receiptInfoRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
            <Text style={receiptStyles.receiptInfoLabel}>{t("level")}</Text>
            <Text style={receiptStyles.receiptInfoValue}>{options.level}</Text>
          </View>
          <View style={[receiptStyles.receiptInfoRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
            <Text style={receiptStyles.receiptInfoLabel}>{t("track")}</Text>
            <Text style={receiptStyles.receiptInfoValue}>{options.track ?? "—"}</Text>
          </View>
          <View style={[receiptStyles.receiptInfoRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
            <Text style={receiptStyles.receiptInfoLabel}>{t("subject")}</Text>
            <Text style={receiptStyles.receiptInfoValue}>{options.subject}</Text>
          </View>
          <View style={[receiptStyles.receiptInfoRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
            <Text style={receiptStyles.receiptInfoLabel}>{t("groupType")}</Text>
            <Text style={receiptStyles.receiptInfoValue}>{groupLabel}</Text>
          </View>
        </View>

        <Text style={receiptStyles.receiptMonthLabel}>{monthLabel}</Text>

        <Text style={receiptStyles.receiptSectionLabel}>{t("installments")}</Text>
        <View style={receiptStyles.tableCard}>
          <View style={[receiptStyles.headerRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
            <View style={receiptStyles.receiptHeaderCell}>
              <Text style={receiptStyles.headerCellText}>{t("dueDate")}</Text>
            </View>
            <View style={receiptStyles.receiptHeaderCell}>
              <Text style={receiptStyles.headerCellText}>{t("amountDue")}</Text>
            </View>
            <View style={receiptStyles.receiptHeaderCell}>
              <Text style={receiptStyles.headerCellText}>{t("paid")} / {t("unpaid")}</Text>
            </View>
            <View style={receiptStyles.receiptHeaderCell}>
              <Text style={receiptStyles.headerCellText}>{t("remainingAmount")}</Text>
            </View>
          </View>
          <View style={receiptStyles.headerAccentStrip} />
          {installments.length === 0 ? (
            <View style={[receiptStyles.row, rtl ? { flexDirection: "row-reverse" } : {}]}>
              <View style={[receiptStyles.receiptBodyCell, { flex: 4 }]}>
                <Text style={receiptStyles.markMuted}>{t("noPaymentsDue")}</Text>
              </View>
            </View>
          ) : (
            installments.map((payment, idx) => {
              const paidAmount = Math.min(payment.amountDue, payment.amountPaid ?? 0);
              const isPartiallyPaid = !payment.isPaid && paidAmount > 0;
              const remainingAmount = Math.max(0, payment.amountDue - paidAmount);
              return (
              <View
                key={payment.id}
                style={[receiptStyles.row, idx % 2 === 1 ? receiptStyles.zebraRow : {}, rtl ? { flexDirection: "row-reverse" } : {}]}
              >
                <View style={receiptStyles.receiptBodyCell}>
                  <Text style={receiptStyles.receiptCellText}>{payment.dueDate}</Text>
                </View>
                <View style={receiptStyles.receiptBodyCell}>
                  <Text style={receiptStyles.receiptCellText}>{payment.amountDue} MAD</Text>
                </View>
                <View style={receiptStyles.receiptBodyCell}>
                  <Text
                    style={
                      payment.isPaid
                        ? receiptStyles.amountPaid
                        : isPartiallyPaid
                          ? receiptStyles.amountPartiallyPaid
                          : receiptStyles.amountUnpaid
                    }
                  >
                    {payment.isPaid
                      ? t("paid")
                      : isPartiallyPaid
                        ? `${t("paid")} ${paidAmount}`
                        : t("unpaid")}
                  </Text>
                </View>
                <View style={receiptStyles.receiptBodyCell}>
                  <Text
                    style={
                      isPartiallyPaid
                        ? receiptStyles.amountPartiallyPaid
                        : receiptStyles.receiptCellText
                    }
                  >
                    {payment.isPaid ? "0" : remainingAmount} MAD
                  </Text>
                </View>
              </View>
              );
            })
          )}
        </View>

        <View style={receiptStyles.receiptTotalRow}>
          <Text style={receiptStyles.receiptTotalLabel}>{t("totalRow")}</Text>
          <Text style={receiptStyles.receiptTotalValue}>{totalAmount} MAD</Text>
        </View>

        {totalRemaining > 0 && (
          <View style={[receiptStyles.receiptTotalRow, { marginTop: 6 }]}>
            <Text style={receiptStyles.receiptTotalLabel}>{t("paidSoFar")}</Text>
            <Text style={[receiptStyles.receiptTotalValue, { color: "#1e9e50" }]}>
              {totalPaid} MAD
            </Text>
          </View>
        )}
        {totalRemaining > 0 && (
          <View style={[receiptStyles.receiptTotalRow, { marginTop: 6, backgroundColor: "#fdf3dd" }]}>
            <Text style={[receiptStyles.receiptTotalLabel, { color: "#b57e0a" }]}>
              {t("remainingAmount")}
            </Text>
            <Text style={[receiptStyles.receiptTotalValue, { color: "#b57e0a" }]}>
              {totalRemaining} MAD
            </Text>
          </View>
        )}

        <Text style={receiptStyles.receiptSectionLabel}>{t("attendanceSummary")}</Text>
        <View style={[receiptStyles.statsRow, rtl ? { flexDirection: "row-reverse" } : {}]}>
          <View style={receiptStyles.statBox}>
            <Text style={receiptStyles.statValue}>{sessionsDelivered}</Text>
            <Text style={receiptStyles.statLabel}>{t("sessionsDelivered")}</Text>
          </View>
          <View style={receiptStyles.statBox}>
            <Text style={[receiptStyles.statValue, { color: "#1e9e50" }]}>{presentCount}</Text>
            <Text style={receiptStyles.statLabel}>{t("presentCount")}</Text>
          </View>
          <View style={receiptStyles.statBox}>
            <Text style={[receiptStyles.statValue, { color: "#dc2828" }]}>{absentCount}</Text>
            <Text style={receiptStyles.statLabel}>{t("absentCount")}</Text>
          </View>
          <View style={receiptStyles.statBox}>
            <Text style={receiptStyles.statValue}>{attendanceRatePct}%</Text>
            <Text style={receiptStyles.statLabel}>{t("attendanceRateLabel")}</Text>
          </View>
        </View>

        <ReportFooter rtl={rtl} t={t} />
      </Page>
    </Document>
  );
}

/** Builds, renders and downloads a single-student, single-subject, single-month receipt PDF. */
export async function renderEnnajdStudentReceiptPdf(
  options: RenderStudentReceiptOptions,
): Promise<RenderReportResult> {
  const instance = pdf(<StudentReceiptDocument options={options} />);
  const blob = await instance.toBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const fileSafeSubject = options.subject.replace(/\s+/g, "_");
  const fileSafeName = `${options.student.firstName}_${options.student.lastName}`.replace(/\s+/g, "_");
  link.href = url;
  link.download = `recu_${fileSafeName}_${fileSafeSubject}_${options.monthKey}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return { fontDegraded: false };
}
