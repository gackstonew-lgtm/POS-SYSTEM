-- Migration: 001_convert_stock_quantity_to_numeric.sql
ALTER TABLE public.products ALTER COLUMN stock_quantity TYPE NUMERIC USING stock_quantity::NUMERIC;
ALTER TABLE public.products ALTER COLUMN reorder_level TYPE NUMERIC USING reorder_level::NUMERIC;
ALTER TABLE public.products ALTER COLUMN stock_quantity SET DEFAULT 0;
ALTER TABLE public.products ALTER COLUMN reorder_level SET DEFAULT 5;
