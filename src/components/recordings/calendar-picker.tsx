"use client";

import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format, addDays, subDays, isToday } from "date-fns";
import { tzFromDate } from "@/lib/timezone";

interface CalendarPickerProps {
  selectedDate: Date;
  onDateChange: (date: Date) => void;
}

export function CalendarPicker({
  selectedDate,
  onDateChange,
}: CalendarPickerProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <Button
        variant="ghost"
        size="icon"
        className="tap-target"
        onClick={() => onDateChange(subDays(selectedDate, 1))}
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>
      <span className="text-sm font-medium">
        {isToday(tzFromDate(selectedDate))
          ? "Today"
          : format(tzFromDate(selectedDate), "EEE, MMM d")}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="tap-target"
        disabled={isToday(selectedDate)}
        onClick={() => onDateChange(addDays(selectedDate, 1))}
      >
        <ChevronRight className="h-5 w-5" />
      </Button>
    </div>
  );
}
