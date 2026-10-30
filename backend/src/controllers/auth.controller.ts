import type { RequestHandler } from "express";
import { registerUser } from "../services/auth.service.js";

export const registerController: RequestHandler = async (
  request,
  response
) => {
  const user = await registerUser(request.body);

  response.status(201).json({ user });
};