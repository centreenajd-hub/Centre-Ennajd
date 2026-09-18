// Supabase database types for Centre Ennajd ERP
// Generated from the SQL schema - keep in sync with the actual database structure

export type Level = "T.C" | "1Bac" | "2Bac" | "1Col" | "2Col" | "3Col";
export type Track = "s.x" | "s.m";
export type GroupType = "Large" | "Small";
export type Subject =
  | "Math"
  | "PC"
  | "SVT"
  | "French"
  | "Arabic"
  | "SocialStudies"
  | "IslamicStudies"
  | "Philosophy"
  | "English";
export type SessionKind = "recurring" | "one_off";
export type AttendanceStatus = "present" | "absent";
export type PaymentRule = "A" | "B";

export interface Database {
  public: {
    Tables: {
      students: {
        Row: {
          id: string;
          first_name: string;
          last_name: string;
          whatsapp_phone: string;
          parent_phone: string;
          level: Level;
          track: Track | null;
          enrollments: SubjectEnrollment[];
          created_at: string;
          updated_at: string;
          registration_fee: RegistrationFee | null;
          // Optional: a database that hasn't run the advance_balance
          // migration won't return this column, and readers normalise with ?? 0.
          advance_balance?: number;
        };
        Insert: {
          id?: string;
          first_name: string;
          last_name: string;
          whatsapp_phone: string;
          parent_phone: string;
          level: Level;
          track?: Track | null;
          enrollments?: SubjectEnrollment[];
          created_at?: string;
          updated_at?: string;
          registration_fee?: RegistrationFee | null;
          advance_balance?: number;
        };
        Update: {
          id?: string;
          first_name?: string;
          last_name?: string;
          whatsapp_phone?: string;
          parent_phone?: string;
          level?: Level;
          track?: Track | null;
          enrollments?: SubjectEnrollment[];
          created_at?: string;
          updated_at?: string;
          registration_fee?: RegistrationFee | null;
          advance_balance?: number;
        };
      };
      sessions: {
        Row: {
          id: string;
          subject: Subject;
          level: Level;
          track: Track | null;
          group_type: GroupType | null;
          day_of_week: number;
          start_time: string;
          end_time: string;
          teacher_name: string | null;
          kind: SessionKind | null;
          date: string | null;
        };
        Insert: {
          id?: string;
          subject: Subject;
          level: Level;
          track?: Track | null;
          group_type?: GroupType | null;
          day_of_week: number;
          start_time: string;
          end_time: string;
          teacher_name?: string | null;
          kind?: SessionKind | null;
          date?: string | null;
        };
        Update: {
          id?: string;
          subject?: Subject;
          level?: Level;
          track?: Track | null;
          group_type?: GroupType | null;
          day_of_week?: number;
          start_time?: string;
          end_time?: string;
          teacher_name?: string | null;
          kind?: SessionKind | null;
          date?: string | null;
        };
      };
      prices: {
        Row: {
          id: string;
          level: Level;
          subject: Subject;
          track: Track | null;
          group_type: GroupType | null;
          price: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          level: Level;
          subject: Subject;
          track?: Track | null;
          group_type?: GroupType | null;
          price: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          level?: Level;
          subject?: Subject;
          track?: Track | null;
          group_type?: GroupType | null;
          price?: number;
          created_at?: string;
        };
      };
      attendance_records: {
        Row: {
          id: string;
          student_id: string;
          session_id: string;
          date: string;
          status: AttendanceStatus;
          marked_at: string;
          timestamp: string;
          is_guest: boolean | null;
        };
        Insert: {
          id?: string;
          student_id: string;
          session_id: string;
          date: string;
          status: AttendanceStatus;
          marked_at?: string;
          timestamp: string;
          is_guest?: boolean | null;
        };
        Update: {
          id?: string;
          student_id?: string;
          session_id?: string;
          date?: string;
          status?: AttendanceStatus;
          marked_at?: string;
          timestamp?: string;
          is_guest?: boolean | null;
        };
      };
      payments: {
        Row: {
          id: string;
          student_id: string;
          subject: Subject;
          due_date: string;
          month: string;
          is_paid: boolean;
          amount_due: number;
          amount_paid: number;
          is_half_month: boolean;
          rule: PaymentRule;
          updated_at: string;
        };
        Insert: {
          id?: string;
          student_id: string;
          subject: Subject;
          due_date: string;
          month: string;
          is_paid?: boolean;
          amount_due: number;
          amount_paid?: number;
          is_half_month?: boolean;
          rule: PaymentRule;
          updated_at?: string;
        };
        Update: {
          id?: string;
          student_id?: string;
          subject?: Subject;
          due_date?: string;
          month?: string;
          is_paid?: boolean;
          amount_due?: number;
          amount_paid?: number;
          is_half_month?: boolean;
          rule?: PaymentRule;
          updated_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          level: Level;
          title: string;
          body: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          level: Level;
          title: string;
          body: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          level?: Level;
          title?: string;
          body?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}

// Supporting types (used in multiple tables)
export interface SubjectEnrollment {
  subject: Subject;
  track: Track | null;
  groupType: GroupType | null;
  customPrice?: number;
  enrolledAt?: string;
  paymentNote?: string;
  subscriptionMonths?: number;
}

export interface RegistrationFee {
  amountDue: number;
  amountPaid: number;
  note?: string;
  settledAt?: string;
  updatedAt?: string;
}

// Flat Row type aliases for easy import in dbServices / field-mapping.
// These use snake_case column names matching the Supabase schema.
export type StudentsRow = Database["public"]["Tables"]["students"]["Row"];
export type SessionsRow = Database["public"]["Tables"]["sessions"]["Row"];
export type PricesRow = Database["public"]["Tables"]["prices"]["Row"];
export type AttendanceRecordsRow =
  Database["public"]["Tables"]["attendance_records"]["Row"];
export type PaymentsRow = Database["public"]["Tables"]["payments"]["Row"];
export type MessagesRow = Database["public"]["Tables"]["messages"]["Row"];