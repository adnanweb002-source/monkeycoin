-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "persistent_left_bv" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "persistent_right_bv" DECIMAL(65,30) NOT NULL DEFAULT 0;
