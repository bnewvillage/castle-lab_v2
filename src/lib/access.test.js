import { supabase, fetchAppRole } from './supabase';

// The database answers is_app_user() / is_app_admin() for the signed-in user.
const answers = (user, admin, error = null) =>
  jest.spyOn(supabase, 'rpc').mockImplementation((fn) =>
    Promise.resolve(error ? { data: null, error } : { data: fn === 'is_app_user' ? user : admin, error: null }));

afterEach(() => jest.restoreAllMocks());

test('on the roster as admin', async () => {
  answers(true, true);
  await expect(fetchAppRole()).resolves.toBe('admin');
});

test('on the roster as viewer', async () => {
  answers(true, false);
  await expect(fetchAppRole()).resolves.toBe('viewer');
});

test('not on the roster', async () => {
  answers(false, false);
  await expect(fetchAppRole()).resolves.toBeNull();
});

test('a database error is thrown, never read as "not authorised"', async () => {
  answers(null, null, { message: 'network down' });
  await expect(fetchAppRole()).rejects.toEqual({ message: 'network down' });
});

test('asks the database, not a built-in list', async () => {
  const spy = answers(true, false);
  await fetchAppRole();
  expect(spy.mock.calls.map(c => c[0]).sort()).toEqual(['is_app_admin', 'is_app_user']);
});
