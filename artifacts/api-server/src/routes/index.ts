import { Router, type IRouter } from "express";
import healthRouter from "./health";
import leaderboardRouter from "./leaderboard.ts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(leaderboardRouter);

export default router;
