/**
 * What the API actually sends back.
 *
 * These are the contract between the two apps: the web types its queries with
 * them, and the API annotates its service methods with them. That second half
 * is what makes them worth having — without it a server change still breaks a
 * page silently, which is exactly how `product.brand` went from a string to an
 * object and took the product page down.
 *
 * Money is always a decimal string, never a number: JSON has one numeric type
 * and it is binary floating point. Dates are always ISO strings.
 */

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

/** A list that is not paged, but still says how much there is. */
export interface Listed<T> {
  data: T[];
  meta: { total: number };
}

export interface NamedRef {
  id: string;
  name: string;
}

export interface WarehouseRef {
  id: string;
  name: string;
  code: string;
}
