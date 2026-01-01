/*
  Warnings:

  - Added the required column `type` to the `holidays` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."holidays" ADD COLUMN     "type" TEXT NOT NULL;
